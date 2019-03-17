//! The MIDI editor is the view that is used to actually create music.  It renders a stack of rows
//! that correspond to individual notes.  It supports operations like dragging notes around,
//! selecting/deleting notes, and playing the current composition.

use super::super::{helpers::grid::prelude::*, prelude::*, view_context::ViewContext};

pub mod constants;
pub mod input_handlers;
pub mod prelude;
pub mod render;
pub mod state;

impl Default for MidiEditorGridHandler {
    fn default() -> Self {
        Self {
            synth: PolySynth::new(true),
        }
    }
}

pub struct MidiEditorGridHandler {
    pub synth: PolySynth,
}

struct MidiEditorGridRenderer;

type MidiGrid = Grid<usize, MidiEditorGridRenderer, MidiEditorGridHandler>;

impl GridRenderer for MidiEditorGridRenderer {
    fn create_note(x: usize, y: usize, width: usize, height: usize) -> usize {
        js::render_quad(FG_CANVAS_IX, x, y, width, height, "note")
    }

    fn select_note(dom_id: usize) { js::add_class(dom_id, "selected"); }

    fn deselect_note(dom_id: usize) { js::remove_class(dom_id, "selected"); }

    fn create_cursor(conf: &GridConf, cursor_pos_beats: usize) -> usize {
        js::render_line(
            FG_CANVAS_IX,
            cursor_pos_beats,
            0,
            cursor_pos_beats,
            conf.grid_height(),
            "cursor",
        )
    }

    fn set_cursor_pos(x: usize) {
        // TODO
    }
}

impl GridHandler<usize, MidiEditorGridRenderer> for MidiEditorGridHandler {
    fn init(&mut self) {
        unsafe {
            state::init_state();
        };
    }

    fn on_note_select(&mut self, dom_id: &DomId) {}

    fn on_note_double_click(&mut self, dom_id: &DomId) {}

    fn on_note_deleted(&mut self, dom_id: DomId) {
        // TODO
    }

    fn on_key_down(
        &mut self,
        grid: &mut MidiGrid,
        key: &str,
        control_pressed: bool,
        shift_pressed: bool,
    ) {
        let (line_diff_vertical, beat_diff_horizontal) = match (control_pressed, shift_pressed) {
            (true, false) | (false, true) => (3, 4.0),
            (true, true) => (5, 16.0),
            (false, false) => (1, 1.0),
        };

        match key {
            "w" => self.move_notes_vertical(true, grid, line_diff_vertical),
            "s" => self.move_notes_vertical(false, grid, line_diff_vertical),
            "ArrowLeft" | "a" =>
                self.move_selected_notes_horizontal(grid, false, beat_diff_horizontal),
            "ArrowRight" | "d" =>
                self.move_selected_notes_horizontal(grid, true, beat_diff_horizontal),
            "z" | "x" => self.play_selected_notes(),
            " " => {
                self.start_playback(grid);
                self.serialize_and_save_composition(grid);
            },
            _ => (),
        }
    }

    fn on_selection_region_update(
        &mut self,
        grid: &mut MidiGrid,
        retained_region: &Option<SelectionRegion>,
        changed_region_1: &ChangedRegion,
        changed_region_2: &ChangedRegion,
    ) {
        // Look for all notes in the added/removed regions and add/remove them from the
        // selected notes set and select/deselect their UI representations
        for (was_added, region) in &[
            (changed_region_1.was_added, changed_region_1.region),
            (changed_region_2.was_added, changed_region_2.region),
        ] {
            for note_data in grid.data.iter_region(region) {
                // Ignore notes that are also contained in the retained region
                if let Some(retained_region) = retained_region.as_ref() {
                    if note_data.intersects_region(&retained_region) {
                        continue;
                    }
                }

                let dom_id = note_data.note_box.data.get_id();
                let selected_note_data: SelectedNoteData =
                    SelectedNoteData::from_note_box(note_data.line_ix, note_data.note_box);
                let line_ix = selected_note_data.line_ix;
                if *was_added && grid.selected_notes.insert(selected_note_data) {
                    R::select_note(dom_id);
                    self.synth.trigger_attack(self.midi_to_frequency(line_ix));
                } else if !*was_added && self.selected_notes.remove(&selected_note_data) {
                    R::deselect_note(dom_id);
                    self.synth.trigger_release(self.midi_to_frequency(line_ix));
                }
            }
        }
    }

    fn on_selection_box_deleted(&mut self, grid: &mut MidiGrid) {
        for note_data in grid.selected_notes.iter() {
            self.synth
                .trigger_release(self.midi_to_frequency(note_data.line_ix));
        }
    }

    fn create_note(&mut self, line_ix: usize, start_beat: f32, dom_id: usize) -> DomId {
        // Right now, we don't have any additional data to store for notes outside of their actual
        // position on the grid and line index, so we just use their `dom_id` as their state.
        dom_id
    }
}

impl MidiEditorGridHandler {
    fn start_playback(&mut self, grid: &MidiGrid) {
        // Get an iterator of sorted attack/release events to process
        let events = grid.data.iter_events(None);

        // Create a virtual poly synth to handle assigning the virtual notes to voices
        let mut voice_manager = PolySynth::new(false);

        // Trigger all of the events with a custom callback that records the voice index to use for
        // each of them.
        // `scheduled_events` is an array of `(is_attack, voice_ix)` pairs represented as bytes for
        // efficient transfer across the FFI.
        let mut scheduled_events: Vec<u8> = Vec::with_capacity(events.size_hint().0 * 2);
        let mut frequencies: Vec<f32> = Vec::with_capacity(events.size_hint().0 / 2);
        let mut event_timings: Vec<f32> = Vec::with_capacity(events.size_hint().0);
        for event in events {
            let frequency = self.midi_to_frequency(grid.conf.row_count, event.line_ix);
            scheduled_events.push(tern(event.is_start, 1, 0));
            let event_time_seconds = ((event.beat / self.conf.bpm) * 60.0) / 4.0;
            event_timings.push(event_time_seconds);

            if event.is_start {
                frequencies.push(frequency);
                voice_manager.trigger_attack_cb(frequency, |_, voice_ix, _| {
                    scheduled_events.push(voice_ix as u8);
                });
            } else {
                voice_manager.trigger_release_cb(frequency, |_, voice_ix| {
                    scheduled_events.push(voice_ix as u8);
                });
            }
        }

        // Ship all of these events over to be scheduled and played
        synth::schedule_events(
            self.synth.id,
            &scheduled_events,
            &frequencies,
            &event_timings,
        );
    }

    fn midi_to_frequency(&self, row_count: usize, line_ix: usize) -> f32 {
        27.5 * (2.0f32).powf(((row_count - line_ix) as f32) / 12.0)
    }

    fn move_note_vertical(
        &self,
        up: bool,
        grid: &mut MidiGrid,
        notes_to_play: &mut Vec<f32>,
        mut note_data: SelectedNoteData,
        line_diff_vertical: usize,
    ) -> SelectedNoteData {
        let cond = tern(
            up,
            note_data.line_ix >= line_diff_vertical,
            note_data.line_ix + line_diff_vertical < grid.conf.row_count,
        );
        if !cond {
            return note_data;
        }

        let dst_line_ix = if up {
            note_data.line_ix - line_diff_vertical
        } else {
            note_data.line_ix + line_diff_vertical
        };
        notes_to_play.push(self.midi_to_frequency(grid.conf.row_count, dst_line_ix));

        let move_failed =
            grid.data
                .move_note_vertical(note_data.line_ix, dst_line_ix, note_data.start_beat);
        if !move_failed {
            note_data.line_ix = dst_line_ix;
            js::set_attr(
                note_data.dom_id,
                "y",
                &(note_data.line_ix * grid.conf.padded_line_height()
                    + grid.conf.cursor_gutter_height)
                    .to_string(),
            );
        }

        note_data
    }

    fn move_notes_vertical(&mut self, up: bool, grid: &mut MidiGrid, line_diff_vertical: usize) {
        let notes = grid.get_sorted_selected_notes(!up);
        let mut notes_to_play: Vec<f32> = Vec::with_capacity(notes.len());

        grid.selected_notes = notes
            .into_iter()
            .cloned()
            .map(|note_data| {
                self.move_note_vertical(up, grid, &mut notes_to_play, note_data, line_diff_vertical)
            })
            .collect();
        self.synth.trigger_attacks(&notes_to_play);
        self.synth.trigger_releases(&notes_to_play);
    }

    fn move_selected_notes_horizontal(
        &mut self,
        grid: &mut MidiGrid,
        right: bool,
        beat_diff_horizontal: f32,
    ) {
        let beats_to_move = beat_diff_horizontal * tern(right, 1.0, -1.0);
        let move_note_horizontal = |mut note_data: SelectedNoteData| -> SelectedNoteData {
            let new_start_beat = grid.data.move_note_horizontal(
                note_data.line_ix,
                note_data.start_beat,
                beats_to_move,
            );

            js::set_attr(
                note_data.dom_id,
                "x",
                &(grid.beats_to_px(new_start_beat)).to_string(),
            );

            note_data.start_beat = new_start_beat;
            note_data
        };

        grid.selected_notes = grid
            .get_sorted_selected_notes(right)
            .into_iter()
            .cloned()
            .map(move_note_horizontal)
            .collect();
    }

    pub fn play_selected_notes(&self) {
        for SelectedNoteData { line_ix, .. } in self.selected_notes.iter() {
            self.synth.trigger_attack(self.midi_to_frequency(*line_ix));
        }
    }

    pub fn release_selected_notes(&self) {
        for SelectedNoteData { line_ix, .. } in self.selected_notes.iter() {
            self.synth.trigger_release(self.midi_to_frequency(*line_ix));
        }
    }

    pub fn serialize_and_save_composition(&mut self, grid: &mut MidiGrid) {
        // Get a list of every note in the composition matched with its line index
        let all_notes: Vec<RawNoteData> = self
            .data
            .lines
            .iter()
            .enumerate()
            .flat_map(|(line_ix, line)| {
                line.iter().map(move |note_box| RawNoteData {
                    line_ix: line_ix as u32,
                    start_beat: note_box.bounds.start_beat,
                    width: note_box.bounds.width(),
                })
            })
            .collect();

        let mut base64_data = Vec::new();
        {
            let mut base64_encoder = base64::write::EncoderWriter::new(
                &mut base64_data,
                base64::Config::new(base64::CharacterSet::Standard, true),
            );
            bincode::serialize_into(&mut base64_encoder, &all_notes)
                .expect("Error binary-encoding note data");
            base64_encoder
                .finish()
                .expect("Error base64-encoding note data");
        }
        let base64_str = unsafe { str::from_utf8_unchecked(&base64_data) };

        js::save_composition(base64_str);
    }
}

pub fn mk_midi_editor(config: &str) -> Box<dyn ViewContext> {
    let conf = GridConf {
        gutter_height: constants::CURSOR_GUTTER_HEIGHT,
        row_height: constants::LINE_HEIGHT,
        row_count: constants::LINE_COUNT,
        beat_length_px: 20,
        cursor_gutter_height: constants::CURSOR_GUTTER_HEIGHT,
        line_border_width: constants::LINE_BORDER_WIDTH,
        line_height: constants::LINE_HEIGHT,
        note_snap_beat_interval: constants::NOTE_SNAP_BEAT_INTERVAL,
    };

    let view_context = MidiEditorGridHandler::default();
    let grid: Box<MidiGrid> = box Grid::new(conf, view_context);

    grid
}
