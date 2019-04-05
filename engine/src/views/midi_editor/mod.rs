//! The MIDI editor is the view that is used to actually create music.  It renders a stack of rows
//! that correspond to individual notes.  It supports operations like dragging notes around,
//! selecting/deleting notes, and playing the current composition.

use std::str;

use crate::{helpers::grid::prelude::*, view_context::ViewContext};

pub mod constants;
pub mod input_handlers;
pub mod prelude;
pub mod state;

pub struct MidiEditorGridHandler {
    pub synth: PolySynth,
}

impl Default for MidiEditorGridHandler {
    fn default() -> Self {
        Self {
            synth: PolySynth::new(true),
        }
    }
}

struct MidiEditorGridRenderer;

type MidiGrid = Grid<usize, MidiEditorGridRenderer, MidiEditorGridHandler>;

impl GridRenderer<usize> for MidiEditorGridRenderer {}

impl GridHandler<usize, MidiEditorGridRenderer> for MidiEditorGridHandler {
    fn init(&mut self) {
        unsafe {
            state::init_state();
        };

        js::init_midi_editor_ui();
    }

    fn cleanup(&mut self) {
        js::cleanup_midi_editor_ui();
    }

    fn on_key_down(
        &mut self,
        grid_state: &mut GridState<usize>,
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
            "ArrowUp" | "w" => self.move_notes_vertical(true, grid_state, line_diff_vertical),
            "ArrowDown" | "s" => self.move_notes_vertical(false, grid_state, line_diff_vertical),
            "ArrowLeft" | "a" =>
                self.move_selected_notes_horizontal(grid_state, false, beat_diff_horizontal),
            "ArrowRight" | "d" =>
                self.move_selected_notes_horizontal(grid_state, true, beat_diff_horizontal),
            "z" | "x" => self.play_selected_notes(grid_state),
            " " => {
                self.start_playback(grid_state);
                self.serialize_and_save_composition(grid_state);
            },
            _ => (),
        }
    }

    fn on_key_up(
        &mut self,
        grid_state: &mut GridState<usize>,
        key: &str,
        _control_pressed: bool,
        _shift_pressed: bool,
    ) {
        match key {
            "z" | "x" => self.release_selected_notes(grid_state),
            " " => synth::stop_playback(),
            _ => (),
        }
    }

    fn on_note_click(
        &mut self,
        grid_state: &mut GridState<usize>,
        line_ix: usize,
        clicked_note_key: NodeSlabKey<usize>,
    ) {
        let clicked_note_box = &grid_state.data.lines[line_ix]
            .get_node(clicked_note_key)
            .val;
        let SelectedNoteData { line_ix, .. } =
            SelectedNoteData::from_note_box(line_ix, clicked_note_box);

        if grid_state.cur_tool == Tool::DrawNote && !grid_state.shift_pressed {
            self.synth
                .trigger_attack(self.midi_to_frequency(grid_state.conf.row_count, line_ix));
        }
    }

    fn on_selection_region_update(
        &mut self,
        grid_state: &mut GridState<usize>,
        retained_region: &Option<SelectionRegion>,
        changed_region_1: &ChangedRegion,
        changed_region_2: &ChangedRegion,
    ) {
        trace!("on_selection_region_update");
        // Look for all notes in the added/removed regions and add/remove them from the
        // selected notes set and select/deselect their UI representations
        for (was_added, region) in &[
            (changed_region_1.was_added, &changed_region_1.region),
            (changed_region_2.was_added, &changed_region_2.region),
        ] {
            let min_beat = grid_state.conf.px_to_beat(region.x);
            let max_beat = grid_state.conf.px_to_beat(region.x + region.width);
            let start_line_ix = (region.y - (region.y % grid_state.conf.padded_line_height()))
                / grid_state.conf.padded_line_height();

            // Convert the pixels of the region into line indices and beats
            let end_px_ix = region.y + region.height;
            let end_line_ix = ((end_px_ix - (end_px_ix % grid_state.conf.padded_line_height()))
                / grid_state.conf.padded_line_height())
            .min(grid_state.conf.row_count - 1);
            for note_data in
                grid_state
                    .data
                    .iter_region(start_line_ix, end_line_ix, min_beat, max_beat)
            {
                // Ignore notes that are also contained in the retained region
                if let Some(retained_region) = retained_region.as_ref() {
                    if note_data.intersects_region(&grid_state.conf, &retained_region) {
                        continue;
                    }
                }

                let dom_id = note_data.note_box.data.get_id();
                let selected_note_data: SelectedNoteData =
                    SelectedNoteData::from_note_box(note_data.line_ix, note_data.note_box);
                let line_ix = selected_note_data.line_ix;
                if *was_added && grid_state.selected_notes.insert(selected_note_data) {
                    MidiEditorGridRenderer::select_note(dom_id);
                    self.synth
                        .trigger_attack(self.midi_to_frequency(grid_state.conf.row_count, line_ix));
                } else if !*was_added && grid_state.selected_notes.remove(&selected_note_data) {
                    MidiEditorGridRenderer::deselect_note(dom_id);
                    self.synth.trigger_release(
                        self.midi_to_frequency(grid_state.conf.row_count, line_ix),
                    );
                }
            }
        }
    }

    fn on_selection_box_deleted(&mut self, grid_state: &mut GridState<usize>) {
        for note_data in grid_state.selected_notes.iter() {
            self.synth.trigger_release(
                self.midi_to_frequency(grid_state.conf.row_count, note_data.line_ix),
            );
        }
    }

    fn create_note(
        &mut self,
        grid_state: &mut GridState<usize>,
        line_ix: usize,
        _start_beat: f32,
        dom_id: usize,
    ) -> DomId {
        self.synth
            .trigger_release(self.midi_to_frequency(grid_state.conf.row_count, line_ix));

        // Right now, we don't have any additional data to store for notes outside of their actual
        // position on the grid and line index, so we just use their `dom_id` as their state.
        dom_id
    }

    fn on_note_move(
        &mut self,
        grid_state: &mut GridState<usize>,
        _dom_id: DomId,
        old_line_ix: usize,
        _old_start_beat: f32,
        new_line_ix: usize,
        _new_start_beat: f32,
    ) {
        if old_line_ix == new_line_ix {
            return;
        }

        self.synth
            .trigger_release(self.midi_to_frequency(grid_state.conf.row_count, old_line_ix));
        self.synth
            .trigger_attack(self.midi_to_frequency(grid_state.conf.row_count, new_line_ix));
    }

    fn on_note_draw_start(&mut self, grid_state: &mut GridState<usize>, line_ix: usize) {
        self.synth
            .trigger_attack(self.midi_to_frequency(grid_state.conf.row_count, line_ix));
    }

    fn on_note_drag_start(
        &mut self,
        grid_state: &mut GridState<usize>,
        dragging_note_data: &(f32, SelectedNoteData),
    ) {
        self.synth.trigger_attack(
            self.midi_to_frequency(grid_state.conf.row_count, dragging_note_data.1.line_ix),
        );
    }

    fn on_note_drag_stop(
        &mut self,
        grid_state: &mut GridState<usize>,
        dragging_note_data: &(f32, SelectedNoteData),
    ) {
        self.synth.trigger_release(
            self.midi_to_frequency(grid_state.conf.row_count, dragging_note_data.1.line_ix),
        );
    }
}

impl MidiEditorGridHandler {
    fn start_playback(&mut self, grid_state: &GridState<usize>) {
        // Get an iterator of sorted attack/release events to process
        let events = grid_state.data.iter_events(None);

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
            let frequency = self.midi_to_frequency(grid_state.conf.row_count, event.line_ix);
            scheduled_events.push(tern(event.is_start, 1, 0));
            // TODO: make BPM configurable
            let event_time_seconds = ((event.beat / 120.) * 60.0) / 4.0;
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
        grid_state: &mut GridState<usize>,
        notes_to_play: &mut Vec<f32>,
        mut note_data: SelectedNoteData,
        line_diff_vertical: usize,
    ) -> SelectedNoteData {
        let cond = tern(
            up,
            note_data.line_ix >= line_diff_vertical,
            note_data.line_ix + line_diff_vertical < grid_state.conf.row_count,
        );
        if !cond {
            return note_data;
        }

        let dst_line_ix = if up {
            note_data.line_ix - line_diff_vertical
        } else {
            note_data.line_ix + line_diff_vertical
        };
        notes_to_play.push(self.midi_to_frequency(grid_state.conf.row_count, dst_line_ix));

        let move_failed = grid_state.data.move_note_vertical(
            note_data.line_ix,
            dst_line_ix,
            note_data.start_beat,
        );
        if !move_failed {
            note_data.line_ix = dst_line_ix;
            js::set_attr(
                note_data.dom_id,
                "y",
                &(note_data.line_ix * grid_state.conf.padded_line_height()
                    + grid_state.conf.cursor_gutter_height)
                    .to_string(),
            );
        }

        note_data
    }

    fn move_notes_vertical(
        &mut self,
        up: bool,
        grid_state: &mut GridState<usize>,
        line_diff_vertical: usize,
    ) {
        let (mut notes_to_play, sorted_selected_notes): (Vec<f32>, Vec<SelectedNoteData>) = {
            let notes = grid_state.get_sorted_selected_notes(!up);
            let notes_to_play: Vec<f32> = Vec::with_capacity(notes.len());

            // We have to `.collect()` these since the reference is retained in the iterator type.
            // Very sad.
            (notes_to_play, notes.into_iter().cloned().collect())
        };

        grid_state.selected_notes = sorted_selected_notes
            .into_iter()
            .map(|note_data| {
                self.move_note_vertical(
                    up,
                    grid_state,
                    &mut notes_to_play,
                    note_data,
                    line_diff_vertical,
                )
            })
            .collect();
        self.synth.trigger_attacks(&notes_to_play);
        self.synth.trigger_releases(&notes_to_play);
    }

    fn move_selected_notes_horizontal(
        &mut self,
        grid_state: &mut GridState<usize>,
        right: bool,
        beat_diff_horizontal: f32,
    ) {
        let beats_to_move = beat_diff_horizontal * tern(right, 1.0, -1.0);
        let cloned_conf = grid_state.conf.clone();

        let sorted_selected_notes: Vec<SelectedNoteData> = grid_state
            .get_sorted_selected_notes(right)
            .into_iter()
            .cloned()
            .collect();

        let move_note_horizontal = move |data: &mut NoteLines<usize>,
                                         mut note_data: SelectedNoteData|
              -> SelectedNoteData {
            let new_start_beat =
                data.move_note_horizontal(note_data.line_ix, note_data.start_beat, beats_to_move);

            js::set_attr(
                note_data.dom_id,
                "x",
                &(cloned_conf.beats_to_px(new_start_beat)).to_string(),
            );

            note_data.start_beat = new_start_beat;
            note_data
        };

        let new_selected_notes = sorted_selected_notes
            .into_iter()
            .map(|note_data| move_note_horizontal(&mut grid_state.data, note_data))
            .collect();
        grid_state.selected_notes = new_selected_notes;
    }

    pub fn play_selected_notes(&mut self, grid_state: &GridState<usize>) {
        for SelectedNoteData { line_ix, .. } in grid_state.selected_notes.iter() {
            self.synth
                .trigger_attack(self.midi_to_frequency(grid_state.conf.row_count, *line_ix));
        }
    }

    pub fn release_selected_notes(&mut self, grid_state: &GridState<usize>) {
        for SelectedNoteData { line_ix, .. } in grid_state.selected_notes.iter() {
            self.synth
                .trigger_release(self.midi_to_frequency(grid_state.conf.row_count, *line_ix));
        }
    }

    pub fn serialize_and_save_composition(&mut self, grid_state: &mut GridState<usize>) {
        // Get a list of every note in the composition matched with its line index
        let all_notes: Vec<RawNoteData> = grid_state
            .data
            .lines
            .iter()
            .enumerate()
            .flat_map(|(line_ix, line)| {
                line.iter().map(move |note_box| RawNoteData {
                    line_ix,
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

/// Return `MidiEditor` instance as a `ViewContext` given the provided config string.
pub fn mk_midi_editor(_config: &str) -> Box<dyn ViewContext> {
    // TODO: Parse the config and use that rather than the constants
    let conf = GridConf {
        gutter_height: constants::CURSOR_GUTTER_HEIGHT,
        row_count: constants::LINE_COUNT,
        beat_length_px: constants::BEAT_LENGTH_PX,
        cursor_gutter_height: constants::CURSOR_GUTTER_HEIGHT,
        line_border_width: constants::LINE_BORDER_WIDTH,
        line_height: constants::LINE_HEIGHT,
        note_snap_beat_interval: constants::NOTE_SNAP_BEAT_INTERVAL,
        grid_width: constants::GRID_WIDTH,
        measure_width_px: constants::BEATS_PER_MEASURE * constants::BEAT_LENGTH_PX,
    };

    let view_context = MidiEditorGridHandler::default();
    let grid: Box<MidiGrid> = box Grid::new(conf, view_context);

    grid
}
