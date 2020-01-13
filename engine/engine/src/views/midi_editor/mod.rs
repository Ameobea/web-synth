//! The MIDI editor is the view that is used to actually create music.  It renders a stack of rows
//! that correspond to individual notes.  It supports operations like dragging notes around,
//! selecting/deleting notes, and playing the current composition.

use std::str;

use uuid::Uuid;

use crate::{helpers::grid::prelude::*, view_context::ViewContext};

pub mod constants;
pub mod prelude;

pub struct MidiEditorGridHandler {
    pub vc_id: String,
}

impl MidiEditorGridHandler {
    fn new(vc_id: Uuid) -> Self {
        MidiEditorGridHandler {
            vc_id: vc_id.to_string(),
        }
    }
}

struct MidiEditorGridRenderer;

type MidiGrid = Grid<usize, MidiEditorGridRenderer, MidiEditorGridHandler>;

impl GridRenderer<usize> for MidiEditorGridRenderer {}

impl GridHandler<usize, MidiEditorGridRenderer> for MidiEditorGridHandler {
    fn init(&mut self, vc_id: &str) {
        unsafe {
            skip_list::SKIP_LIST_NODE_DEBUG_POINTERS =
                Box::into_raw(Box::new(skip_list::blank_shortcuts()));
        };

        js::init_midi_editor_ui(vc_id);
    }

    fn hide(&mut self, vc_id: &str) { js::hide_midi_editor(vc_id) }

    fn unhide(&mut self, vc_id: &str) { js::unhide_midi_editor(vc_id) }

    fn cleanup(&mut self, _: &mut GridState<usize>, vc_id: &str) {
        js::cleanup_midi_editor_ui(vc_id);
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
            "q" => self.play_selected_notes(grid_state),
            "z" | "x" | "c" | "v" => {
                let direction_multiplier = tern(key == "z" || key == "c", -1., 1.);
                let adjustment_amount = 0.25
                    * tern(control_pressed, 2., 1.)
                    * tern(shift_pressed, 2., 1.)
                    * direction_multiplier;
                let is_left = key == "z" || key == "x";
                self.adjust_note_lengths(grid_state, is_left, adjustment_amount);
            },
            " " => self.start_playback(grid_state),
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
            " " => (), // TODO // synth::stop_playback(),
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

        trace!("Triggering attack of line_ix {}", line_ix);
        if grid_state.cur_tool == Tool::DrawNote && !grid_state.shift_pressed {
            js::midi_editor_trigger_attack(&self.vc_id, grid_state.conf.row_count - line_ix);
        }
    }

    fn on_selection_region_update(
        &mut self,
        grid_state: &mut GridState<usize>,
        retained_region: &Option<SelectionRegion>,
        changed_region_1: &ChangedRegion,
        changed_region_2: &ChangedRegion,
    ) {
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
                    js::midi_editor_trigger_attack(
                        &self.vc_id,
                        grid_state.conf.row_count - line_ix,
                    );
                } else if !*was_added && grid_state.selected_notes.remove(&selected_note_data) {
                    MidiEditorGridRenderer::deselect_note(dom_id);
                    js::midi_editor_trigger_release(
                        &self.vc_id,
                        grid_state.conf.row_count - line_ix,
                    );
                }
            }
        }
    }

    fn on_selection_box_deleted(&mut self, grid_state: &mut GridState<usize>) {
        for note_data in grid_state.selected_notes.iter() {
            js::midi_editor_trigger_release(
                &self.vc_id,
                grid_state.conf.row_count - note_data.line_ix,
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
        trace!("Triggering release of note on line_ix {}", line_ix);
        js::midi_editor_trigger_release(&self.vc_id, grid_state.conf.row_count - line_ix);

        // Right now, we don't have any additional data to store for notes outside of their actual
        // position on the grid and line index, so we just use their `dom_id` as their state.
        dom_id
    }

    fn cancel_note_create(
        &mut self,
        grid_state: &mut GridState<usize>,
        line_ix: usize,
        _note_dom_id: DomId,
    ) {
        trace!("Triggering release of note on line_ix {}", line_ix);
        js::midi_editor_trigger_release(&self.vc_id, grid_state.conf.row_count - line_ix);
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

        js::midi_editor_trigger_release(&self.vc_id, grid_state.conf.row_count - old_line_ix);
        js::midi_editor_trigger_attack(&self.vc_id, grid_state.conf.row_count - new_line_ix);
    }

    fn on_note_draw_start(&mut self, grid_state: &mut GridState<usize>, line_ix: usize) {
        trace!("triggering attack on line_ix {}", line_ix);
        js::midi_editor_trigger_attack(&self.vc_id, grid_state.conf.row_count - line_ix);
    }

    fn on_note_drag_start(
        &mut self,
        grid_state: &mut GridState<usize>,
        dragging_note_data: &(f32, SelectedNoteData),
    ) {
        trace!(
            "Triggering attack on line_ix {}",
            dragging_note_data.1.line_ix
        );
        js::midi_editor_trigger_attack(
            &self.vc_id,
            grid_state.conf.row_count - dragging_note_data.1.line_ix,
        );
    }

    fn on_note_drag_stop(
        &mut self,
        grid_state: &mut GridState<usize>,
        dragging_note_data: &(f32, SelectedNoteData),
    ) {
        trace!(
            "Triggering release on line_ix {}",
            dragging_note_data.1.line_ix
        );
        js::midi_editor_trigger_release(
            &self.vc_id,
            grid_state.conf.row_count - dragging_note_data.1.line_ix,
        );
    }

    fn handle_message(
        &mut self,
        grid_state: &mut GridState<usize>,
        key: &str,
        _val: &[u8],
    ) -> Option<Vec<u8>> {
        match key {
            "export_midi" => Some(grid_state.serialize_to_binary()),
            _ => None,
        }
    }

    fn get_audio_connectables(&self, uuid: Uuid) -> JsValue {
        js::create_midi_editor_audio_connectables(&uuid.to_string())
    }
}

impl MidiEditorGridHandler {
    fn start_playback(&mut self, grid_state: &GridState<usize>) {
        // Get an iterator of sorted attack/release events to process
        let events = grid_state.data.iter_events(None);

        // Trigger all of the events with a custom callback that records the voice index to use for
        // each of them.
        //
        // `scheduled_events` is an array of `is_attack` flags represented as bytes for transfer
        // across the FFI.
        let mut is_attack_flags: Vec<u8> = Vec::with_capacity(events.size_hint().0 * 2);
        let mut note_ids: Vec<usize> = Vec::with_capacity(events.size_hint().0 / 2);
        let mut event_timings: Vec<f32> = Vec::with_capacity(events.size_hint().0);
        for event in events {
            let note_id = grid_state.conf.row_count - event.line_ix;
            note_ids.push(note_id);
            is_attack_flags.push(tern(event.is_start, 1, 0));
            // TODO: make BPM configurable
            let event_time_seconds = ((event.beat / 120.) * 60.0) / 4.0;
            event_timings.push(event_time_seconds);
        }

        // Ship all of these events over to be scheduled and played
        js::midi_editor_schedule_events(&self.vc_id, &is_attack_flags, &note_ids, &event_timings);
    }

    fn midi_to_frequency(&self, row_count: usize, line_ix: usize) -> f32 {
        27.5 * (2.0f32).powf(((row_count - line_ix) as f32) / 12.0)
    }

    fn move_note_vertical(
        &self,
        up: bool,
        grid_state: &mut GridState<usize>,
        notes_to_play: &mut Vec<usize>,
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
        notes_to_play.push(grid_state.conf.row_count - dst_line_ix);

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
        let (mut notes_to_play, sorted_selected_notes): (Vec<usize>, Vec<SelectedNoteData>) = {
            let notes = grid_state.get_sorted_selected_notes(!up);
            let notes_to_play: Vec<usize> = Vec::with_capacity(notes.len());

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

        for note_id in notes_to_play {
            js::midi_editor_trigger_attack_release(&self.vc_id, note_id, 0.08);
        }
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

    fn adjust_note_lengths(
        &mut self,
        grid_state: &mut GridState<usize>,
        is_left: bool,
        adjustment_amount_beats: f32,
    ) {
        let mut old_selected_notes = grid_state.selected_notes.drain().collect::<Vec<_>>();
        // We need to sort the selected notes so that those on the side towards which we are
        // adjusting them are updated first, giving the maximum opportunity for movement.
        let sort_reverse =
            is_left && adjustment_amount_beats > 0. || !is_left && adjustment_amount_beats < 0.;
        if sort_reverse {
            old_selected_notes.sort_unstable_by(|a, b| b.cmp(a));
        } else {
            old_selected_notes.sort_unstable();
        }
        let new_selected_notes = &mut grid_state.selected_notes;

        for selected_note_data in old_selected_notes {
            // Compute where we're trying to set this note's new endpoints to
            let new_note_start_beat = tern(
                is_left,
                selected_note_data.start_beat + adjustment_amount_beats,
                selected_note_data.start_beat,
            );
            let new_note_end_beat = tern(
                is_left,
                selected_note_data.start_beat + selected_note_data.width,
                (selected_note_data.start_beat + selected_note_data.width)
                    + adjustment_amount_beats,
            );
            // Put them in order in case their direction has changed due to this adjustment
            let (mut new_note_start_beat, mut new_note_end_beat) =
                if new_note_start_beat < new_note_end_beat {
                    (new_note_start_beat, new_note_end_beat)
                } else {
                    (new_note_end_beat, new_note_start_beat)
                };

            // If this adjustment would set the note to have a width of zero, just leave it as-is
            if new_note_start_beat == new_note_end_beat {
                new_selected_notes.insert(selected_note_data);
                continue;
            }

            let mut is_before = true;
            for note in grid_state.data.iter_region(
                selected_note_data.line_ix,
                selected_note_data.line_ix,
                new_note_start_beat,
                new_note_end_beat,
            ) {
                if note.note_box.data.get_id() == selected_note_data.dom_id {
                    is_before = false;
                    continue;
                }

                if is_before {
                    new_note_start_beat = new_note_start_beat.max(note.note_box.bounds.end_beat);
                } else {
                    new_note_end_beat = new_note_end_beat.min(note.note_box.bounds.start_beat);
                    break;
                }
            }

            let line = &mut grid_state.data.lines[selected_note_data.line_ix];

            let removed_note = line
                .remove(selected_note_data.start_beat)
                .expect("Tried removing existing note but it wasn't found");
            let dom_id = removed_note.data.get_id();
            debug_assert!(dom_id == selected_note_data.dom_id);
            let new_note = NoteBox {
                bounds: NoteBoxBounds {
                    start_beat: new_note_start_beat,
                    end_beat: new_note_end_beat,
                },
                data: removed_note.data,
            };
            new_selected_notes.insert(SelectedNoteData::from_note_box(
                selected_note_data.line_ix,
                &new_note,
            ));
            let new_note_width = new_note.bounds.width();
            let insert_err = line.insert(new_note);
            debug_assert!(insert_err.is_none());

            js::set_attr(
                dom_id,
                "x",
                &(grid_state.conf.beats_to_px(new_note_start_beat)).to_string(),
            );
            js::set_attr(
                dom_id,
                "width",
                &(grid_state.conf.beats_to_px(new_note_width).to_string()),
            )
        }
    }

    pub fn play_selected_notes(&mut self, grid_state: &GridState<usize>) {
        for SelectedNoteData { line_ix, .. } in grid_state.selected_notes.iter() {
            js::midi_editor_trigger_attack(&self.vc_id, grid_state.conf.row_count - *line_ix);
        }
    }

    pub fn release_selected_notes(&mut self, grid_state: &GridState<usize>) {
        for SelectedNoteData { line_ix, .. } in grid_state.selected_notes.iter() {
            js::midi_editor_trigger_release(&self.vc_id, grid_state.conf.row_count - *line_ix);
        }
    }
}

/// Return `MidiEditor` instance as a `ViewContext` given the provided config string.
pub fn mk_midi_editor(_config: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
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

    let view_context = MidiEditorGridHandler::new(uuid);
    let grid: Box<MidiGrid> = Box::new(Grid::new(conf, view_context, uuid));

    grid
}
