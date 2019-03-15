use std::{f32, marker::PhantomData};

use fnv::FnvHashSet;

use super::super::prelude::*;

pub mod constants;
pub mod note_box;
pub mod prelude;
pub mod selection_box;
pub mod skip_list;

use self::{prelude::*, skip_list::NoteLines};

type DomId = usize;

pub trait GridRendererUniqueIdentifier {
    fn get_id(&self) -> DomId;
}

pub trait GridRenderer {
    /// Draws a note on the canvas and returns its DOM id.
    fn create_note(x: usize, y: usize, width: usize, height: usize) -> DomId;
    /// Given a note's `DomId`, mark it as selected in the visualization
    fn select_note(dom_id: DomId);
    /// Given a note's `DomId`, mark it as deselected in the visualization
    fn deselect_note(dom_id: DomId);

    fn create_cursor() -> DomId;
    fn set_cursor_pos(x: usize);
}

pub trait GridHandler<S> {
    fn init(&mut self);

    fn on_note_select(&mut self, data: &S);
    fn on_note_double_click(&mut self, data: &S);
}

#[derive(Clone, Copy, PartialEq)]
pub enum Tool {
    /// A new note will be drawn starting at wherever the mouse is pressed
    DrawNote,
    /// Any note clicked on will be deleted
    DeleteNote,
}

/// `Grid` is a view context that consists of a set of horizontal rows in which segments, currently
/// called **Notes**, are rendered.  It handles the minutiae of rendering the grid, selecting/
/// deselecting notes, drawing/deleting notes, and passing events down to an attached
/// `GridHandler`.
///
/// The `GridHandler` has the job of implementing custom grid logic.  For the MIDI editor, this
/// includes things like playing the synth when notes are drawn, allowing note movement between
/// different levels, etc.  For the `ClipCompositor`, this includes switching the view to the
/// MIDI editor for a specific track when it's double clicked.
///
/// Finally, it has a `GridRenderer` which is just a bunch of type-level functions that are used
/// to render custom versions of the individual elements of the grid.
pub struct Grid<S, R: GridRenderer, H: GridHandler<S>> {
    pub conf: GridConf,
    pub data: NoteLines<S>,
    pub selected_notes: FnvHashSet<SelectedNoteData>,
    pub cursor_pos_beats: f32,
    pub mouse_down: bool,
    pub cursor_moving: bool,
    pub mouse_down_x: usize,
    pub mouse_down_y: usize,
    pub shift_pressed: bool,
    pub control_pressed: bool,
    pub cur_note_bounds: (f32, Option<f32>),
    pub cur_tool: Tool,
    pub mouse_x: usize,
    pub mouse_y: usize,
    pub drawing_note_dom_id: Option<usize>,
    /// (original_dragging_note_start_beat, SelectedNoteData)
    pub dragging_note_data: Option<(f32, SelectedNoteData)>,
    pub selection_box_dom_id: Option<usize>,
    // TODO: Make this something better, like mapping dom_id to line index and start beat or sth.
    pub cursor_dom_id: usize,
    pub playback_active: bool,
    pub synth: PolySynth,
    pub handler: H,
    renderer: PhantomData<R>,
}

pub struct GridConf {
    pub row_count: usize,
    pub row_height: usize,
    pub gutter_height: usize,
    pub beat_length_px: usize,
    pub note_snap_beat_interval: f32,
    pub cursor_gutter_height: usize,
    pub line_border_width: usize,
    pub line_height: usize,
}

impl GridConf {
    pub fn padded_line_height(&self) -> usize { self.line_height + self.line_border_width }

    pub fn grid_height(&self) -> usize { self.row_count * self.padded_line_height() }
}

impl<S, R: GridRenderer, H: GridHandler<S>> Grid<S, R, H> {
    pub fn new(conf: GridConf, handler: H) -> Self {
        Grid {
            conf,
            data: NoteLines::new(constants::NOTE_SKIP_LIST_LEVELS),
            selected_notes: FnvHashSet::default(),
            cursor_pos_beats: 0.0,
            mouse_down: false,
            cursor_moving: false,
            mouse_down_x: 0,
            mouse_down_y: 0,
            shift_pressed: false,
            control_pressed: false,
            cur_note_bounds: (0., None),
            cur_tool: Tool::DrawNote,
            mouse_x: 0,
            mouse_y: 0,
            drawing_note_dom_id: None,
            dragging_note_data: None,
            selection_box_dom_id: None,
            synth: PolySynth::new(true),
            cursor_dom_id: 0,
            playback_active: false,
            handler,
            renderer: PhantomData,
        }
    }

    // TODO
    fn init(&mut self) {}
}

impl<S: GridRendererUniqueIdentifier, R: GridRenderer, H: GridHandler<S>> ViewContext
    for Grid<S, R, H>
{
    fn init(&mut self) { self.handler.init(); }

    fn cleanup(&mut self) { unimplemented!() }

    fn handle_key_down(&mut self, key: &str, control_pressed: bool, shift_pressed: bool) {
        // TODO: Check for focus on the canvas either on the frontend or here

        let (line_diff_vertical, beat_diff_horizontal) = match (control_pressed, shift_pressed) {
            (true, false) | (false, true) => (3, 4.0),
            (true, true) => (5, 16.0),
            (false, false) => (1, 1.0),
        };

        let move_notes_vertical = |up: bool| {
            let notes = self.get_sorted_selected_notes(!up);
            let mut notes_to_play: Vec<f32> = Vec::with_capacity(notes.len());

            let move_note_vertical = |mut note_data: SelectedNoteData| -> SelectedNoteData {
                let cond = tern(
                    up,
                    note_data.line_ix >= line_diff_vertical,
                    note_data.line_ix + line_diff_vertical < self.conf.row_count,
                );
                if !cond {
                    return note_data;
                }

                let dst_line_ix = if up {
                    note_data.line_ix - line_diff_vertical
                } else {
                    note_data.line_ix + line_diff_vertical
                };
                notes_to_play.push(self.midi_to_frequency(dst_line_ix));

                let move_failed = self.data.move_note_vertical(
                    note_data.line_ix,
                    dst_line_ix,
                    note_data.start_beat,
                );
                if !move_failed {
                    note_data.line_ix = dst_line_ix;
                    js::set_attr(
                        note_data.dom_id,
                        "y",
                        &(note_data.line_ix * self.conf.padded_line_height()
                            + self.conf.cursor_gutter_height)
                            .to_string(),
                    );
                }

                note_data
            };

            self.selected_notes = notes.into_iter().cloned().map(move_note_vertical).collect();
            self.synth.trigger_attacks(&notes_to_play);
            self.synth.trigger_releases(&notes_to_play);
        };

        let move_selected_notes_horizontal = |right: bool| {
            let beats_to_move = beat_diff_horizontal * tern(right, 1.0, -1.0);
            let move_note_horizontal = |mut note_data: SelectedNoteData| -> SelectedNoteData {
                let new_start_beat = self.data.move_note_horizontal(
                    note_data.line_ix,
                    note_data.start_beat,
                    beats_to_move,
                );

                js::set_attr(
                    note_data.dom_id,
                    "x",
                    &(self.beats_to_px(new_start_beat)).to_string(),
                );

                note_data.start_beat = new_start_beat;
                note_data
            };

            self.selected_notes = self
                .get_sorted_selected_notes(right)
                .into_iter()
                .cloned()
                .map(move_note_horizontal)
                .collect();
        };

        self.control_pressed = control_pressed;
        self.shift_pressed = shift_pressed;

        match key {
            // Delete all currently selected notes
            "Backspace" | "Delete" =>
                for note_data in self.selected_notes.drain() {
                    let removed_note = self.data.remove(note_data.line_ix, note_data.start_beat);
                    debug_assert!(removed_note.is_some());
                    js::delete_element(note_data.dom_id);

                    if cfg!(debug_assertions) {
                        common::log(format!("{:?}", self.data.lines[note_data.line_ix]));
                    }
                },
            "ArrowUp" | "w" => move_notes_vertical(true),
            "ArrowDown" | "s" => move_notes_vertical(false),
            "ArrowRight" | "d" => move_selected_notes_horizontal(true),
            "ArrowLeft" | "a" => move_selected_notes_horizontal(false),
            "p" => self.copy_selected_notes(),
            "z" | "x" => self.play_selected_notes(),
            " " => {
                self.start_playback();
                self.serialize_and_save_composition();
            },
            _ => (),
        }
    }

    fn handle_key_up(&mut self, key: &str, control_pressed: bool, shift_pressed: bool) {
        self.control_pressed = control_pressed;
        self.shift_pressed = shift_pressed;

        match key {
            "z" | "x" => self.release_selected_notes(),
            " " => synth::stop_playback(),
            _ => (),
        }
    }

    fn handle_mouse_down(&mut self, x: usize, y: usize) {
        let mut drawing_dom_id = None;
        let mut selection_box_dom_id = None;
        let mut dragging_note_data = None;

        // Determine if the requested location intersects an existing note and if not, determine the
        // bounds on the note that will be drawn next.
        let line_ix = match self.get_line_index(y) {
            Some(line_ix) => line_ix,
            None => {
                // click must be in the cursor gutter
                if self.shift_pressed {
                    // TODO: make dedicated function in `render` probably
                    self.selection_box_dom_id = Some(js::render_quad(
                        FG_CANVAS_IX,
                        0,
                        y as usize,
                        0,
                        self.conf.grid_height(),
                        "selection-box",
                    ))
                } else {
                    self.selection_box_dom_id = None;
                }

                let x = self.set_cursor_pos(self.px_to_beat(x)) as usize;
                self.cursor_moving = true;
                self.mouse_down = true;
                self.mouse_down_x = x;
                self.mouse_down_y = self.conf.grid_height() - 2;

                return;
            },
        };
        let beat = self.px_to_beat(x);
        let bounds = self.data.get_bounds(line_ix, beat);

        if self.cur_tool == Tool::DrawNote && !self.shift_pressed {
            self.synth.trigger_attack(self.midi_to_frequency(line_ix));
        }

        let mut init_selection_box = || {
            self.deselect_all_notes();

            // TODO: make dedicated function in `render` probably
            selection_box_dom_id = Some(js::render_quad(FG_CANVAS_IX, x, y, 0, 0, "selection-box"));
        };

        match bounds {
            skip_list::Bounds::Intersecting(note) => match self.cur_tool {
                Tool::DeleteNote => {
                    let dom_id = note.data;
                    R::deselect_note(dom_id);
                    js::delete_element(dom_id);
                    self.data.remove(line_ix, note.bounds.start_beat);
                },
                Tool::DrawNote if self.shift_pressed => init_selection_box(),
                Tool::DrawNote if self.control_pressed => {
                    let selected_data = SelectedNoteData::from_note_box(line_ix, note);

                    if self.selected_notes.contains(&selected_data) {
                        self.selected_notes.remove(&selected_data);
                        R::deselect_note(note.data);
                    } else {
                        // Select the clicked note since it wasn't previously selected
                        self.selected_notes.insert(selected_data);
                        R::select_note(note.data);
                    }
                },
                Tool::DrawNote => {
                    let note_data = SelectedNoteData::from_note_box(line_ix, note);
                    dragging_note_data = Some((note.bounds.start_beat, note_data));
                    self.deselect_all_notes();
                    self.selected_notes.insert(note_data);
                    R::select_note(note.data);
                },
            },
            skip_list::Bounds::Bounded(lower, upper) => match self.cur_tool {
                Tool::DrawNote if self.control_pressed => {}, // TODO
                Tool::DrawNote if self.shift_pressed => init_selection_box(),
                Tool::DrawNote => {
                    let snapped_lower = self.snap_to_beat_interval(x, self.beats_to_px(lower));
                    let snapped_upper = (snapped_lower
                        + self.beats_to_px(self.conf.note_snap_beat_interval))
                    .min(self.beats_to_px(upper.unwrap_or(f32::INFINITY)));
                    let width = snapped_upper - snapped_lower;
                    self.cur_note_bounds = (lower, upper);

                    // Draw the temporary/candidate note after storing its bounds
                    drawing_dom_id = Some(R::create_note(line_ix, snapped_lower, width));
                    x = snapped_lower as usize;
                },
                _ => (),
            },
        };

        self.mouse_down = true;
        self.cursor_moving = false;
        self.mouse_down_x = x;
        self.mouse_down_y = y;
        self.drawing_note_dom_id = drawing_dom_id;
        self.selection_box_dom_id = selection_box_dom_id;
        self.dragging_note_data = dragging_note_data;
    }

    fn handle_mouse_move(&mut self, x: usize, y: usize) {
        let (last_x, last_y) = (self.mouse_x, self.mouse_y);
        self.mouse_x = x;
        self.mouse_y = y;
        if !self.mouse_down {
            return;
        }

        if self.cursor_moving {
            self.mouse_y = 1;
            if let Some(selection_box_dom_id) = self.selection_box_dom_id {
                self.update_selection_box(selection_box_dom_id, last_x, last_y, x, 1);
            } else {
                self.set_cursor_pos(self.px_to_beat(x as f32));
            }
            return;
        }

        match self.cur_tool {
            Tool::DrawNote if self.shift_pressed => {
                if let Some(selection_box_dom_id) = self.selection_box_dom_id {
                    self.update_selection_box(selection_box_dom_id, last_x, last_y, x, y);
                }
            },
            Tool::DrawNote => {
                if let Some(dom_id) = self.drawing_note_dom_id {
                    let NoteBoxData { x, width } = self.compute_note_box_data(x);
                    js::set_attr(dom_id, "x", &x.to_string());
                    js::set_attr(dom_id, "width", &width.to_string());
                } else if let Some((first_dragging_note_start_beat, ref mut dragging_note)) =
                    self.dragging_note_data
                {
                    // Figure out if we've moved far enough to warrant a move
                    let original_line_ix = dragging_note.line_ix;
                    let new_line_ix = self.get_line_index(y).unwrap();

                    let horizontal_movement_diff_px = x - self.mouse_down_x;
                    let horizontal_movement_diff_beats =
                        self.px_to_beat(horizontal_movement_diff_px);
                    let horizontal_movement_intervals = (horizontal_movement_diff_beats
                        / self.conf.note_snap_beat_interval)
                        .round();
                    let original_start_beat = dragging_note.start_beat;
                    let new_start_beat = first_dragging_note_start_beat
                        + (horizontal_movement_intervals * self.conf.note_snap_beat_interval);

                    if original_line_ix == new_line_ix && original_start_beat == new_start_beat {
                        return;
                    }

                    // Go with the simple solution: remove from the source line, try to add to the
                    // destination line, re-insert in source line if it's blocked.
                    common::log(format!(
                        "Removing dragging note starting at {}",
                        dragging_note.start_beat
                    ));
                    let original_note = self
                        .data
                        .remove(original_line_ix, dragging_note.start_beat)
                        .unwrap_or_else(|| {
                            panic!(
                                "Tried removing original note starting at {} from the original \
                                 line but it wasn't found",
                                dragging_note.start_beat
                            )
                        });
                    let note_width = original_note.bounds.width();
                    let mut note = original_note.clone();

                    let mut try_insert = |line_ix: usize, start_beat: f32| -> bool {
                        note.bounds.start_beat = start_beat;
                        note.bounds.end_beat = start_beat + note_width;
                        let insertion_error = self.data.insert(line_ix, note.clone());
                        if insertion_error.is_none() {
                            dragging_note.start_beat = start_beat;
                            dragging_note.line_ix = line_ix;
                        }
                        insertion_error.is_some()
                    };

                    let insertion_succeeded = !try_insert(new_line_ix, new_start_beat)
                        || (new_start_beat != original_start_beat
                            && !try_insert(original_line_ix, new_start_beat))
                        || (new_line_ix != original_line_ix
                            && !try_insert(new_line_ix, original_start_beat));
                    if !insertion_succeeded {
                        let reinsertion_error = self.data.insert(original_line_ix, original_note);
                        debug_assert!(reinsertion_error.is_none());
                        return;
                    }

                    self.selected_notes.remove(dragging_note);
                    self.selected_notes.insert(*dragging_note);

                    if dragging_note.start_beat != original_start_beat {
                        js::set_attr(
                            dragging_note.dom_id,
                            "x",
                            &(self.beats_to_px(dragging_note.start_beat) as usize).to_string(),
                        );
                    }
                    if dragging_note.line_ix != original_line_ix {
                        js::set_attr(
                            dragging_note.dom_id,
                            "y",
                            &((dragging_note.line_ix * self.conf.padded_line_height
                                + self.conf.cursor_gutter_height)
                                .to_string()),
                        );
                        self.synth
                            .trigger_release(self.midi_to_frequency(original_line_ix));
                        self.synth
                            .trigger_attack(self.midi_to_frequency(dragging_note.line_ix));
                    }
                }
            },
            _ => (),
        }
    }

    fn handle_mouse_up(&mut self, x: usize, y: usize) {
        // if `MOUSE_DOWN` is not set, the user tried to place an invalid note and we ignore it.
        if !self.mouse_down {
            return;
        }
        self.mouse_down = false;

        let delete_selection_box = |selection_box_dom_id: usize| {
            js::delete_element(selection_box_dom_id);

            for note_data in self.selected_notes.iter() {
                self.synth
                    .trigger_release(self.midi_to_frequency(note_data.line_ix));
            }
        };

        if self.cursor_moving {
            if let Some(selection_box_dom_id) = self.selection_box_dom_id {
                delete_selection_box(selection_box_dom_id);
            }

            self.set_cursor_pos(self.px_to_beat(x as f32));
            return;
        }

        let down_line_ix = self.get_line_index(self.mouse_down_y).unwrap();

        if let Some(selection_box_dom_id) = self.selection_box_dom_id {
            delete_selection_box(selection_box_dom_id);
        } else if let Some((_, dragging_note_data)) = self.dragging_note_data {
            self.synth
                .trigger_release(self.midi_to_frequency(dragging_note_data.line_ix));
        } else {
            self.synth
                .trigger_release(self.midi_to_frequency(down_line_ix));
        }

        if self.cur_tool == Tool::DrawNote {
            match (self.drawing_note_dom_id, self.selection_box_dom_id) {
                (Some(note_dom_id), None) => {
                    let NoteBoxData { x, width } = self.compute_note_box_data(x);
                    if width == 0 {
                        return;
                    }

                    let x_px = x;
                    let start_beat = self.px_to_beat(x_px);
                    let line_ix = down_line_ix;
                    let note = NoteBox {
                        data: note_dom_id,
                        bounds: NoteBoxBounds {
                            start_beat,
                            end_beat: self.px_to_beat(x_px + width),
                        },
                    };

                    self.deselect_all_notes();
                    self.selected_notes.insert(SelectedNoteData {
                        line_ix,
                        dom_id: note_dom_id,
                        start_beat,
                        width: note.bounds.width(),
                    });
                    R::select_note(note_dom_id);

                    // Actually insert the node into the skip list
                    self.data.insert(line_ix, note);
                    if cfg!(debug_assertions) {
                        common::log(format!("{:?}", self.data.lines[line_ix]));
                    }
                },
                (None, Some(_)) => (),
                (Some(_), Some(_)) => common::error(
                    "Both `note_dom_id` and `selection_box_dom_id` exist in `MOUSE_DOWN_DATA`!",
                ),
                (None, None) => (),
            }
        }
    }

    fn handle_mouse_wheel(&mut self, ydiff: isize) { unimplemented!() }

    fn load(&mut self, serialized: &str) { unimplemented!() }

    fn save(&self) -> String { unimplemented!() }
}

impl<S: GridRendererUniqueIdentifier, R: GridRenderer, H: GridHandler> Grid<S, R, H> {
    pub fn px_to_beat(&self, px: usize) -> f32 { px as f32 / (self.conf.beat_length_px as f32) }

    pub fn beats_to_px(&self, beats: f32) -> usize { beats as usize * self.conf.beat_length_px }

    pub fn copy_selected_notes(&mut self) {
        let (earliest_start_beat, latest_end_beat) = self.selected_notes.iter().fold(
            (f32::INFINITY, f32::NEG_INFINITY),
            |(cur_earliest_start, cur_latest_end_beat),
             SelectedNoteData {
                 start_beat, width, ..
             }| {
                (
                    cur_earliest_start.min(*start_beat),
                    cur_latest_end_beat.max(start_beat + width),
                )
            },
        );
        if earliest_start_beat == f32::INFINITY {
            return;
        }

        let offset_beats = self.cursor_pos_beats - earliest_start_beat;
        let mut new_selected_notes = FnvHashSet::default();
        new_selected_notes.reserve(self.selected_notes.len());
        for SelectedNoteData {
            start_beat,
            width,
            line_ix,
            dom_id,
        } in self.selected_notes.iter()
        {
            R::deselect_note(*dom_id);
            let new_start_beat = start_beat + offset_beats;
            let new_end_beat = start_beat + width + offset_beats;
            // try to insert a note `offset_beats` away from the previous note on the same line
            if let skip_list::Bounds::Bounded(start_bound, end_bound_opt) = self
                .data
                .get_bounds(*line_ix, new_start_beat + (width / 0.5))
            {
                if start_bound > new_start_beat
                    || (end_bound_opt
                        .map(|end_bound| end_bound < new_end_beat)
                        .unwrap_or(false))
                {
                    // unable to place note at this position
                    continue;
                }
            }
            let dom_id = R::create_note(
                *line_ix,
                self.beats_to_px(new_start_beat),
                self.beats_to_px(*width),
            );
            let new_note = NoteBox {
                bounds: NoteBoxBounds {
                    start_beat: start_beat + offset_beats,
                    end_beat: start_beat + width + offset_beats,
                },
                data: dom_id,
            };
            let insertion_failed = self.data.insert(*line_ix, new_note.clone());
            debug_assert!(!insertion_failed.is_none());
            R::select_note(dom_id);
            new_selected_notes.insert(SelectedNoteData::from_note_box(*line_ix, &new_note));
        }

        // deselect the old notes and select the new ones
        self.selected_notes = new_selected_notes;

        // move the cursor forward
        let clipboard_end_beat = tern(
            self.cursor_pos_beats < latest_end_beat,
            latest_end_beat,
            earliest_start_beat + offset_beats.abs(),
        );
        let clipboard_width_beats = clipboard_end_beat - earliest_start_beat;
        self.set_cursor_pos(self.cursor_pos_beats + clipboard_width_beats);
    }

    pub fn compute_note_box_data(&self, x: usize) -> NoteBoxData {
        let start_x = self.mouse_down_x; // TODO
        let (low_bound, high_bound) = self.cur_note_bounds;
        let snap_interval_px = self.beats_to_px(self.conf.note_snap_beat_interval);
        let snap_to_px = self.snap_to_beat_interval(x, self.beats_to_px(low_bound));
        let (minx, maxx) = if x >= start_x {
            let end = (snap_to_px + snap_interval_px)
                .min(self.beats_to_px(high_bound.unwrap_or(f32::INFINITY)))
                as usize;
            (start_x, end)
        } else {
            let end = snap_to_px as usize;
            (end, start_x)
        };
        let width = maxx - minx;

        NoteBoxData { x: minx, width }
    }

    pub fn snap_to_beat_interval(&self, px: usize, lower_bound_px: usize) -> usize {
        let beat = self.px_to_beat(px);
        let beats_to_shave = beat % self.conf.note_snap_beat_interval;
        self.beats_to_px(beat - beats_to_shave).max(lower_bound_px)
    }

    pub fn set_cursor_pos(&self, x_beats: f32) -> usize {
        let x_px = self.beats_to_px(x_beats);
        let note_snap_beat_interval_px = self.beats_to_px(self.conf.note_snap_beat_interval);
        let intervals = x_px / note_snap_beat_interval_px;
        let snapped_x_px = intervals * note_snap_beat_interval_px;
        self.cursor_pos_beats = self.px_to_beat(snapped_x_px);
        R::set_cursor_pos(snapped_x_px);
        snapped_x_px
    }

    pub fn deselect_all_notes(&mut self) {
        for note_data in self.selected_notes.drain() {
            R::deselect_note(note_data.dom_id);
        }
    }

    pub fn get_line_index(&self, y: usize) -> Option<usize> {
        if y > self.conf.cursor_gutter_height {
            Some(
                ((y - self.conf.cursor_gutter_height) as f32
                    / (self.conf.padded_line_height() as f32))
                    .trunc() as usize,
            )
        } else {
            None
        }
    }

    pub fn midi_to_frequency(&self, line_ix: usize) -> f32 {
        27.5 * (2.0f32).powf(((self.conf.row_count - line_ix) as f32) / 12.0)
    }

    pub fn get_sorted_selected_notes(&self, sort_reverse: bool) -> Vec<&'static SelectedNoteData> {
        let mut notes: Vec<&SelectedNoteData> = self.selected_notes.iter().collect::<Vec<_>>();

        if sort_reverse {
            notes.sort_unstable_by(|a, b| b.cmp(a));
        } else {
            notes.sort_unstable();
        }

        notes
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

    pub fn start_playback(&mut self) {
        // Get an iterator of sorted attack/release events to process
        let events = self.data.iter_events(None);

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
            let frequency = self.midi_to_frequency(event.line_ix);
            scheduled_events.push(tern(event.is_start, 1, 0));
            let event_time_seconds = ((event.beat / BPM) * 60.0) / 4.0;
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

    pub fn serialize_and_save_composition(&mut self) {
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

    pub fn try_load_saved_composition(&mut self) {
        let base64_data: String = match js::load_composition() {
            Some(data) => data,
            None => return,
        };

        let decoded_bytes: Vec<u8> =
            base64::decode(&base64_data).expect("Invalid base64 was saved.");
        let raw_notes: Vec<RawNoteData> = bincode::deserialize(&decoded_bytes)
            .expect("Unable to decode saved composition from raw bytes.");
        for raw_note in raw_notes {
            let RawNoteData {
                line_ix,
                start_beat,
                width,
            } = raw_note;
            let dom_id = R::create_note(
                line_ix as usize,
                self.beats_to_px(start_beat),
                self.beats_to_px(width),
            );
            let insertion_error = self.data.lines[line_ix as usize].insert(NoteBox {
                data: dom_id,
                bounds: NoteBoxBounds {
                    start_beat,
                    end_beat: start_beat + width,
                },
            });
            debug_assert!(insertion_error.is_none());
        }
    }

    pub fn update_selection_box(
        &mut self,
        selection_box_dom_id: usize,
        last_x: usize,
        last_y: usize,
        x: usize,
        y: usize,
    ) {
        let SelectionBoxData {
            region:
                SelectionRegion {
                    x,
                    y,
                    width,
                    height,
                },
            retained_region,
            changed_region_1,
            changed_region_2,
        } = SelectionBoxData::compute(
            self.mouse_down_x,
            self.mouse_down_y,
            x,
            y.saturating_sub(self.conf.cursor_gutter_height),
            last_x,
            last_y.saturating_sub(self.conf.cursor_gutter_height),
        );
        js::set_attr(selection_box_dom_id, "x", &x.to_string());
        js::set_attr(
            selection_box_dom_id,
            "y",
            &(y + self.conf.cursor_gutter_height).to_string(),
        );
        js::set_attr(selection_box_dom_id, "width", &width.to_string());
        js::set_attr(selection_box_dom_id, "height", &height.to_string());

        // Look for all notes in the added/removed regions and add/remove them from the
        // selected notes set and select/deselect their UI representations
        for (was_added, region) in &[
            (changed_region_1.was_added, changed_region_1.region),
            (changed_region_2.was_added, changed_region_2.region),
        ] {
            for note_data in self.data.iter_region(region) {
                // Ignore notes that are also contained in the retained region
                if let Some(retained_region) = retained_region.as_ref() {
                    if note_data.intersects_region(&retained_region) {
                        continue;
                    }
                }

                let dom_id = note_data.note_box.data;
                let selected_note_data: SelectedNoteData = note_data.into();
                let line_ix = selected_note_data.line_ix;
                if *was_added && self.selected_notes.insert(selected_note_data) {
                    R::select_note(dom_id);
                    self.synth.trigger_attack(self.midi_to_frequency(line_ix));
                } else if !*was_added && self.selected_notes.remove(&selected_note_data) {
                    R::deselect_note(dom_id);
                    self.synth.trigger_release(self.midi_to_frequency(line_ix));
                }
            }
        }
    }
}
