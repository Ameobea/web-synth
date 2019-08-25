use std::{f32, marker::PhantomData, mem, str};

use fnv::FnvHashSet;
use uuid::Uuid;

use super::super::prelude::*;

pub mod constants;
pub mod note_box;
pub mod prelude;
pub mod render;
pub mod selection_box;
pub mod skip_list;

use self::{prelude::*, skip_list::NoteLines};

pub type DomId = usize;

pub trait GridRendererUniqueIdentifier {
    fn get_id(&self) -> DomId;
}

impl GridRendererUniqueIdentifier for usize {
    fn get_id(&self) -> DomId { *self }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Tool {
    /// A new note will be drawn starting at wherever the mouse is pressed
    DrawNote,
    /// Any note clicked on will be deleted
    DeleteNote,
}

pub trait GridRenderer<S: GridRendererUniqueIdentifier> {
    /// Draws a note on the canvas and returns its DOM id.
    fn create_note(
        x: usize,
        y: usize,
        width: usize,
        height: usize,
        dom_id: Option<DomId>,
    ) -> DomId {
        js::render_quad(FG_CANVAS_IX, x, y, width, height, "note", dom_id)
    }

    /// Given a note's `DomId`, mark it as selected in the visualization
    fn select_note(dom_id: usize) { js::add_class(dom_id, "selected"); }

    /// Given a note's `DomId`, mark it as deselected in the visualization
    fn deselect_note(dom_id: usize) { js::remove_class(dom_id, "selected"); }

    /// Render the cursor and return its `DomId`
    fn create_cursor(conf: &GridConf, cursor_pos_beats: usize) -> DomId {
        js::render_line(
            FG_CANVAS_IX,
            cursor_pos_beats,
            0,
            cursor_pos_beats,
            conf.grid_height(),
            "cursor",
        )
    }

    /// Set the position and size of the selection box
    fn set_selection_box(
        conf: &GridConf,
        dom_id: DomId,
        x: usize,
        y: usize,
        width: usize,
        height: usize,
    ) {
        js::set_attr(dom_id, "x", &x.to_string());
        js::set_attr(dom_id, "y", &(y + conf.cursor_gutter_height).to_string());
        js::set_attr(dom_id, "width", &width.to_string());
        js::set_attr(dom_id, "height", &height.to_string());
    }

    /// Set the position of the cursor
    fn set_cursor_pos(dom_id: DomId, x: usize) {
        js::set_attr(dom_id, "x1", &x.to_string());
        js::set_attr(dom_id, "x2", &x.to_string());
    }
}

pub trait GridHandler<S: GridRendererUniqueIdentifier, R: GridRenderer<S>> {
    fn init(&mut self) {}

    fn cleanup(&mut self, _grid_state: &mut GridState<S>) {}

    fn on_note_select(&mut self, _data: &S) {}

    fn on_note_click(
        &mut self,
        _grid_state: &mut GridState<S>,
        _line_ix: usize,
        _clicked_note_key: NodeSlabKey<S>,
    ) {
    }

    fn on_note_double_click(&mut self, _data: &S) {}

    fn on_note_deleted(&mut self, _dom_id: DomId) {}

    fn on_key_down(
        &mut self,
        _state: &mut GridState<S>,
        _key: &str,
        _control_pressed: bool,
        _shift_pressed: bool,
    ) {
    }

    fn on_key_up(
        &mut self,
        _state: &mut GridState<S>,
        _key: &str,
        _control_pressed: bool,
        _shift_pressed: bool,
    ) {
    }

    fn on_mouse_down(&mut self, _state: &mut GridState<S>, _x: usize, _y: usize) {}

    fn on_selection_region_update(
        &mut self,
        _grid: &mut GridState<S>,
        _retained_region: &Option<SelectionRegion>,
        _changed_region_1: &ChangedRegion,
        _changed_region_2: &ChangedRegion,
    ) {
    }

    fn on_selection_box_deleted(&mut self, _grid: &mut GridState<S>) {}

    fn create_note(
        &mut self,
        grid_state: &mut GridState<S>,
        line_ix: usize,
        start_beat: f32,
        dom_id: DomId,
    ) -> S;

    fn cancel_note_create(
        &mut self,
        _grid_state: &mut GridState<S>,
        _line_ix: usize,
        _note_dom_id: DomId,
    ) {
    }

    fn on_note_move(
        &mut self,
        _grid_state: &mut GridState<S>,
        _dom_id: DomId,
        _old_line_ix: usize,
        _old_start_beat: f32,
        _new_line_ix: usize,
        _new_start_beat: f32,
    ) {
    }

    fn on_note_draw_start(&mut self, _grid_state: &mut GridState<S>, _line_ix: usize) {}

    fn on_note_drag_start(
        &mut self,
        _grid_state: &mut GridState<S>,
        _dragging_note_data: &(f32, SelectedNoteData),
    ) {
    }

    fn on_note_drag_stop(
        &mut self,
        _grid_state: &mut GridState<S>,
        _dragging_note_data: &(f32, SelectedNoteData),
    ) {
    }

    fn handle_message(
        &mut self,
        _grid_state: &mut GridState<S>,
        key: &str,
        _val: &[u8],
    ) -> Option<Vec<u8>> {
        match key {
            _ => {
                warn!("Ignoring unhandled message of type \"key\" in grid");
                None
            },
        }
    }
}

pub struct GridState<S> {
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
}

impl<S: GridRendererUniqueIdentifier> GridState<S> {
    fn new(conf: GridConf) -> Self {
        let row_count = conf.row_count;

        Self {
            conf,
            data: NoteLines::new(row_count),
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
            cursor_dom_id: 0,
            playback_active: false,
        }
    }

    pub fn get_sorted_selected_notes<'a>(
        &'a self,
        sort_reverse: bool,
    ) -> Vec<&'a SelectedNoteData> {
        let mut notes: Vec<&SelectedNoteData> = self.selected_notes.iter().collect::<Vec<_>>();

        if sort_reverse {
            notes.sort_unstable_by(|a, b| b.cmp(a));
        } else {
            notes.sort_unstable();
        }

        notes
    }

    pub fn get_raw_note_data(&self) -> Vec<RawNoteData> {
        self.data
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
            .collect()
    }

    pub fn serialize_to_binary(&self) -> Vec<u8> {
        let all_notes: Vec<RawNoteData> = self.get_raw_note_data();

        bincode::serialize(&all_notes).expect("Failed to serialize raw note data into binary")
    }
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
pub struct Grid<S: GridRendererUniqueIdentifier, R: GridRenderer<S>, H: GridHandler<S, R>> {
    pub uuid: Uuid,
    pub state: GridState<S>,
    pub handler: H,
    pub loaded: bool,
    renderer: PhantomData<R>,
}

#[derive(Clone)]
pub struct GridConf {
    pub row_count: usize,
    pub gutter_height: usize,
    pub beat_length_px: usize,
    pub note_snap_beat_interval: f32,
    pub cursor_gutter_height: usize,
    pub line_border_width: usize,
    pub line_height: usize,
    pub grid_width: usize,
    pub measure_width_px: usize,
}

/// Helper trait that allows converting pixel units to beats generically
pub trait PxUnit {
    fn to_f32(self) -> f32;
}

impl PxUnit for usize {
    fn to_f32(self) -> f32 { self as f32 }
}

impl PxUnit for isize {
    fn to_f32(self) -> f32 { self as f32 }
}

impl GridConf {
    pub fn padded_line_height(&self) -> usize { self.line_height + self.line_border_width }

    pub fn grid_height(&self) -> usize {
        self.row_count * self.padded_line_height() + self.cursor_gutter_height
    }

    pub fn get_line_index(&self, y_px: usize) -> Option<usize> {
        if y_px > self.cursor_gutter_height {
            Some(
                ((y_px - self.cursor_gutter_height) as f32 / (self.padded_line_height() as f32))
                    .trunc() as usize,
            )
        } else {
            None
        }
    }

    pub fn px_to_beat<T: PxUnit>(&self, px: T) -> f32 { px.to_f32() / (self.beat_length_px as f32) }

    pub fn beats_to_px(&self, beats: f32) -> usize { (beats * self.beat_length_px as f32) as usize }
}

fn try_insert<S: GridRendererUniqueIdentifier>(
    data: &mut NoteLines<S>,
    mut note: NoteBox<S>,
    line_ix: usize,
    start_beat: f32,
    dragging_note: &mut SelectedNoteData,
) -> Option<NoteBox<S>> {
    note.bounds.end_beat = start_beat + note.bounds.width();
    note.bounds.start_beat = start_beat;
    trace!(
        "Trying to insert {:?} at line_ix: {}, start_beat: {}",
        note,
        line_ix,
        start_beat
    );
    let insertion_error = data.insert(line_ix, note);
    if insertion_error.is_none() {
        trace!("success!");
        trace!("{:?}", data.lines[line_ix]);
        dragging_note.start_beat = start_beat;
        dragging_note.line_ix = line_ix;
    } else {
        trace!("failed");
    }
    insertion_error
}

enum InsertionAttemptResult<S> {
    Inserted { line_ix: usize, start_beat: f32 },
    Failed(NoteBox<S>),
}

fn try_insert_many<S: GridRendererUniqueIdentifier>(
    data: &mut NoteLines<S>,
    note: NoteBox<S>,
    positions: &[(usize, f32)],
    dragging_note: &mut SelectedNoteData,
) -> InsertionAttemptResult<S> {
    if let Some(&(line_ix, start_beat)) = positions.first() {
        match try_insert(data, note, line_ix, start_beat, dragging_note) {
            Some(note) => try_insert_many(data, note, &positions[1..], dragging_note),
            None => InsertionAttemptResult::Inserted {
                line_ix,
                start_beat,
            },
        }
    } else {
        InsertionAttemptResult::Failed(note)
    }
}

impl<S: GridRendererUniqueIdentifier, R: GridRenderer<S>, H: GridHandler<S, R>> Grid<S, R, H> {
    pub fn new(conf: GridConf, handler: H, uuid: Uuid) -> Self {
        Grid {
            uuid,
            state: GridState::new(conf),
            handler,
            loaded: false,
            renderer: PhantomData,
        }
    }

    /// This is called when re-initializing
    fn rerender_all_notes(&self) {
        for note_data in self.state.data.iter() {
            self.render_note(
                note_data.line_ix,
                note_data.note_box.bounds.start_beat,
                note_data.note_box.bounds.width(),
            );
        }
    }

    pub fn render_note(&self, line_ix: usize, start_beat: f32, width: f32) -> DomId {
        R::create_note(
            self.state.conf.beats_to_px(start_beat),
            self.state.conf.cursor_gutter_height + self.state.conf.padded_line_height() * line_ix,
            self.state.conf.beats_to_px(width),
            self.state.conf.line_height,
            None,
        )
    }
}

impl<S: GridRendererUniqueIdentifier, R: GridRenderer<S>, H: GridHandler<S, R>> ViewContext
    for Grid<S, R, H>
{
    fn init(&mut self) {
        render::render_initial_grid(&self.state.conf);
        self.state.cursor_dom_id = R::create_cursor(&self.state.conf, 4);
        self.handler.init();

        if !self.loaded {
            self.try_load_saved_composition();
            self.loaded = true;
        } else {
            self.rerender_all_notes();
        }
    }

    fn cleanup(&mut self) {
        js::clear_canvases();
        js::cleanup_midi_editor();
        self.serialize_and_save();
        self.handler.cleanup(&mut self.state);
    }

    fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

    fn handle_key_down(&mut self, key: &str, control_pressed: bool, shift_pressed: bool) {
        self.state.control_pressed = control_pressed;
        self.state.shift_pressed = shift_pressed;

        match key {
            // Delete all currently selected notes
            "Backspace" | "Delete" => {
                for note_data in self.state.selected_notes.drain() {
                    let removed_note = self
                        .state
                        .data
                        .remove(note_data.line_ix, note_data.start_beat);
                    debug_assert!(removed_note.is_some());
                    // TODO: Make renderer method
                    js::delete_element(note_data.dom_id);
                    self.handler.on_note_deleted(note_data.dom_id);

                    debug!("{:?}", self.state.data.lines[note_data.line_ix]);
                }
            },
            "p" => self.copy_selected_notes(),
            _ => self
                .handler
                .on_key_down(&mut self.state, key, control_pressed, shift_pressed),
        }
    }

    fn handle_key_up(&mut self, key: &str, control_pressed: bool, shift_pressed: bool) {
        self.state.control_pressed = control_pressed;
        self.state.shift_pressed = shift_pressed;

        self.handler
            .on_key_up(&mut self.state, key, control_pressed, shift_pressed);
    }

    fn handle_mouse_down(&mut self, mut x: usize, y: usize) {
        let mut drawing_dom_id = None;
        let mut selection_box_dom_id = None;
        let mut dragging_note_data = None;

        // Determine if the requested location intersects an existing note and if not, determine the
        // bounds on the note that will be drawn next.
        let line_ix = match self.state.conf.get_line_index(y) {
            Some(line_ix) => line_ix,
            None => {
                // click must be in the cursor gutter
                self.handle_cursor_gutter_click(x, y);
                return;
            },
        };
        let beat = self.state.conf.px_to_beat(x);
        let bounds = self.state.data.get_bounds(line_ix, beat);

        match bounds {
            skip_list::Bounds::Intersecting {
                line_ix,
                node_slab_key,
                selected_note_data,
            } => match self.state.cur_tool {
                Tool::DeleteNote => {
                    R::deselect_note(selected_note_data.dom_id);
                    js::delete_element(selected_note_data.dom_id);
                    self.state
                        .data
                        .remove(selected_note_data.line_ix, selected_note_data.start_beat);
                },
                Tool::DrawNote if self.state.shift_pressed => {
                    selection_box_dom_id = self.init_selection_box(x, y);
                },
                Tool::DrawNote if self.state.control_pressed => {
                    if self.state.selected_notes.contains(&selected_note_data) {
                        self.state.selected_notes.remove(&selected_note_data);
                        R::deselect_note(selected_note_data.dom_id);
                    } else {
                        // Select the clicked note since it wasn't previously selected
                        self.state.selected_notes.insert(selected_note_data);
                        R::select_note(selected_note_data.dom_id);
                        self.handler
                            .on_note_click(&mut self.state, line_ix, node_slab_key);
                    }
                },
                Tool::DrawNote => {
                    dragging_note_data = Some((selected_note_data.start_beat, selected_note_data));
                    self.deselect_all_notes();
                    self.state.selected_notes.insert(selected_note_data);
                    R::select_note(selected_note_data.dom_id);
                },
            },
            skip_list::Bounds::Bounded(lower, upper) => match self.state.cur_tool {
                Tool::DrawNote if self.state.control_pressed => {},
                Tool::DrawNote if self.state.shift_pressed => {
                    selection_box_dom_id = self.init_selection_box(x, y);
                },
                // Determine the start location and width of the note to draw based on the
                // preceeding note and measure intervals.
                Tool::DrawNote => {
                    // The lower bound is the measure's start beat or preceeding note's end beat,
                    // whichever comes last.
                    let beat = self.state.conf.px_to_beat(x);
                    let snap_intervals = beat / self.state.conf.note_snap_beat_interval;
                    let interval_start_beat =
                        snap_intervals.trunc() * self.state.conf.note_snap_beat_interval;
                    let snapped_lower_px =
                        self.state.conf.beats_to_px(interval_start_beat.max(lower));
                    // The upper bound is the end of the measure or the following note's start
                    // beat, whichever comes first.
                    let interval_end_beat =
                        interval_start_beat + self.state.conf.note_snap_beat_interval;
                    let snapped_upper_beat = interval_end_beat.min(upper.unwrap_or(f32::INFINITY));
                    let snapped_upper_px = self.state.conf.beats_to_px(snapped_upper_beat);

                    trace!(
                        "interval_start_beat: {}, interval_end_beat: {}",
                        interval_start_beat,
                        interval_end_beat
                    );
                    trace!(
                        "snapped_lower_px: {}, snapped_upper_px: {}",
                        snapped_lower_px,
                        snapped_upper_px
                    );

                    let width = snapped_upper_px - snapped_lower_px;
                    self.state.cur_note_bounds = (lower, upper);

                    // Draw the temporary/candidate note after storing its bounds
                    drawing_dom_id = Some(R::create_note(
                        snapped_lower_px,
                        self.state.conf.cursor_gutter_height
                            + self.state.conf.padded_line_height() * line_ix,
                        width,
                        self.state.conf.line_height,
                        None,
                    ));
                    self.handler.on_note_draw_start(&mut self.state, line_ix);
                    x = snapped_lower_px as usize;
                },
                _ => (),
            },
        };

        self.state.mouse_down = true;
        self.state.cursor_moving = false;
        self.state.mouse_down_x = x;
        self.state.mouse_down_y = y;
        self.state.drawing_note_dom_id = drawing_dom_id;
        self.state.selection_box_dom_id = selection_box_dom_id;
        self.state.dragging_note_data = dragging_note_data;

        self.handler.on_mouse_down(&mut self.state, x, y);

        if let Some(dragging_note_data) = dragging_note_data {
            self.handler
                .on_note_drag_start(&mut self.state, &dragging_note_data);
        }
    }

    fn handle_mouse_move(&mut self, x: usize, y: usize) {
        let (last_x, last_y) = (self.state.mouse_x, self.state.mouse_y);
        self.state.mouse_x = x;
        self.state.mouse_y = y;
        if !self.state.mouse_down {
            return;
        }

        if self.state.cursor_moving {
            self.state.mouse_y = 1;
            if let Some(selection_box_dom_id) = self.state.selection_box_dom_id {
                self.update_selection_box(selection_box_dom_id, last_x, last_y, x, 1);
            } else {
                self.set_cursor_pos(self.state.conf.px_to_beat(x));
            }
            return;
        }

        let mut note_movement_data = None;

        match self.state.cur_tool {
            Tool::DrawNote if self.state.shift_pressed => {
                if let Some(selection_box_dom_id) = self.state.selection_box_dom_id {
                    self.update_selection_box(selection_box_dom_id, last_x, last_y, x, y);
                }
            },
            Tool::DrawNote => {
                if let Some(dom_id) = self.state.drawing_note_dom_id {
                    let NoteBoxData { x, width } = self.compute_note_box_data(x);
                    js::set_attr(dom_id, "x", &x.to_string());
                    js::set_attr(dom_id, "width", &width.to_string());
                } else if let Some((first_dragging_note_start_beat, ref mut dragging_note)) =
                    self.state.dragging_note_data
                {
                    // Figure out if we've moved far enough to warrant a move
                    let original_line_ix = dragging_note.line_ix;
                    let new_line_ix = match self.state.conf.get_line_index(y) {
                        Some(line_ix) => line_ix,
                        None => {
                            // dragged onto the cursor gutter, probably
                            return;
                        },
                    };

                    let horizontal_movement_diff_px = x as isize - self.state.mouse_down_x as isize;
                    let horizontal_movement_diff_beats =
                        self.state.conf.px_to_beat(horizontal_movement_diff_px);
                    let horizontal_movement_intervals = (horizontal_movement_diff_beats
                        / self.state.conf.note_snap_beat_interval)
                        .round();
                    let original_start_beat = dragging_note.start_beat;
                    let new_start_beat = first_dragging_note_start_beat
                        + (horizontal_movement_intervals * self.state.conf.note_snap_beat_interval);

                    if original_line_ix == new_line_ix && original_start_beat == new_start_beat {
                        return;
                    }

                    // Go with the simple solution: remove from the source line, try to add to the
                    // destination line, re-insert in source line if it's blocked.
                    trace!(
                        "Removing dragging note starting at {}",
                        dragging_note.start_beat
                    );
                    let note = self
                        .state
                        .data
                        .remove(original_line_ix, dragging_note.start_beat)
                        .unwrap_or_else(|| {
                            panic!(
                                "Tried removing original note starting at {} from the original \
                                 line but it wasn't found",
                                dragging_note.start_beat
                            )
                        });
                    trace!("Removed note: {:?}", note);

                    // We try to place the note in several positions around the new mouse position,
                    // trying each subsequently until one works (or none work, in which case we
                    // leave the note where it was).
                    let (new_dragging_note_line_ix, new_dragging_note_start_beat): (usize, f32) =
                        match try_insert_many(
                            &mut self.state.data,
                            note,
                            &[
                                (new_line_ix, new_start_beat),
                                (original_line_ix, new_start_beat),
                                (new_line_ix, original_start_beat),
                            ],
                            dragging_note,
                        ) {
                            InsertionAttemptResult::Failed(mut failed_insertion_note) => {
                                // We failed to move the note at all, so reset everything to its
                                // original position and re-insert the note
                                // where we found it.
                                debug!(
                                    "Failed to move note; re-inserting at original start beat: \
                                     {}, line_ix: {}",
                                    original_start_beat, original_line_ix
                                );
                                failed_insertion_note.bounds.start_beat = original_start_beat;
                                dragging_note.start_beat = original_start_beat;
                                dragging_note.line_ix = original_line_ix;
                                let reinsertion_error = self
                                    .state
                                    .data
                                    .insert(original_line_ix, failed_insertion_note);
                                debug_assert!(reinsertion_error.is_none());
                                return;
                            },
                            InsertionAttemptResult::Inserted {
                                line_ix,
                                start_beat,
                            } => {
                                trace!(
                                    "Moved note to start_beat: {}, line_ix: {}",
                                    start_beat,
                                    line_ix
                                );
                                (line_ix, start_beat)
                            },
                        };

                    // We have a custom `Hash` implementation for `SelectedNoteData` that uses its
                    // `DomId` and ignores its position; that's why this works.
                    let was_removed = self.state.selected_notes.remove(dragging_note);
                    debug_assert!(was_removed);
                    let was_added = self.state.selected_notes.insert(*dragging_note);
                    debug_assert!(was_added);

                    if dragging_note.start_beat != original_start_beat {
                        // TODO: move to renderer method
                        js::set_attr(
                            dragging_note.dom_id,
                            "x",
                            &(self.state.conf.beats_to_px(dragging_note.start_beat) as usize)
                                .to_string(),
                        );
                    }
                    if dragging_note.line_ix != original_line_ix {
                        // TODO: move to renderer method
                        js::set_attr(
                            dragging_note.dom_id,
                            "y",
                            &((dragging_note.line_ix * self.state.conf.padded_line_height()
                                + self.state.conf.cursor_gutter_height)
                                .to_string()),
                        );
                    }

                    note_movement_data = Some((
                        dragging_note.dom_id,
                        original_line_ix,
                        original_start_beat,
                        new_dragging_note_line_ix,
                        new_dragging_note_start_beat,
                    ))
                }
            },
            _ => (),
        }

        if let Some((
            dragging_note_dom_id,
            original_dragging_note_line_ix,
            original_dragging_note_start_beat,
            new_dragging_note_line_ix,
            new_dragging_note_start_beat,
        )) = note_movement_data
        {
            self.handler.on_note_move(
                &mut self.state,
                dragging_note_dom_id,
                original_dragging_note_line_ix,
                original_dragging_note_start_beat,
                new_dragging_note_line_ix,
                new_dragging_note_start_beat,
            );
        }
    }

    fn handle_mouse_up(&mut self, x: usize, _y: usize) {
        // if `self.state.mouse_down` is not set, the user tried to place an invalid note and we
        // ignore it.
        if !self.state.mouse_down {
            return;
        }
        self.state.mouse_down = false;

        if let Some(selection_box_dom_id) = self.state.selection_box_dom_id {
            self.delete_selection_box(selection_box_dom_id);
        }

        if self.state.cursor_moving {
            self.set_cursor_pos(self.state.conf.px_to_beat(x));
            self.state.cursor_moving = false;
            return;
        }

        let down_line_ix = self
            .state
            .conf
            .get_line_index(self.state.mouse_down_y)
            .expect("Tried to handle a `mouse_up` event, but we have no `mouse_down_y`");

        if let Some(dragging_note_data) = self.state.dragging_note_data {
            self.handler
                .on_note_drag_stop(&mut self.state, &dragging_note_data);
        }

        if self.state.cur_tool == Tool::DrawNote {
            if let Some(note_dom_id) = self.state.drawing_note_dom_id {
                let NoteBoxData { x, width } = self.compute_note_box_data(x);
                if width == 0 {
                    self.handler
                        .cancel_note_create(&mut self.state, down_line_ix, note_dom_id);
                    js::delete_element(note_dom_id);
                    return;
                }

                let x_px = x;
                let start_beat = self.state.conf.px_to_beat(x_px);
                let line_ix = down_line_ix;
                let note_data =
                    self.handler
                        .create_note(&mut self.state, line_ix, start_beat, note_dom_id);

                let note: NoteBox<S> = NoteBox {
                    data: note_data,
                    bounds: NoteBoxBounds {
                        start_beat,
                        end_beat: self.state.conf.px_to_beat(x_px + width),
                    },
                };

                self.deselect_all_notes();
                self.state.selected_notes.insert(SelectedNoteData {
                    line_ix,
                    dom_id: note_dom_id,
                    start_beat,
                    width: note.bounds.width(),
                });

                R::select_note(note_dom_id);

                // Actually insert the node into the skip list
                self.state.data.insert(line_ix, note);
                debug!("{:?}", self.state.data.lines[line_ix]);
            } else {
                return;
            }

            self.state.drawing_note_dom_id = None;
        }
    }

    fn handle_mouse_wheel(&mut self, _ydiff: isize) {}

    fn handle_message(&mut self, key: &str, val: &[u8]) -> Option<Vec<u8>> {
        match key {
            "set_raw_note_data" => {
                let raw_note_data: Vec<RawNoteData> = match bincode::deserialize(val) {
                    Ok(raw_note_data) => raw_note_data,
                    Err(err) => {
                        error!("Error decoding `RawNoteData`: {:?}", err);
                        return Some(vec![1]);
                    },
                };

                self.reset();
                self.insert_raw_notes(raw_note_data);
                return Some(vec![0]);
            },
            _ => self.handler.handle_message(&mut self.state, key, val),
        }
    }

    fn save(&mut self) -> String {
        "".into() // TODO
    }
}

impl<S: GridRendererUniqueIdentifier, R: GridRenderer<S>, H: GridHandler<S, R>> Grid<S, R, H> {
    /// Handle a click in the cursor gutter, bulk-selecting notes if shift is pressed or moving
    /// the cursor otherwise.
    fn handle_cursor_gutter_click(&mut self, x: usize, y: usize) {
        if self.state.shift_pressed {
            // TODO: make dedicated function in `render` probably
            self.state.selection_box_dom_id = Some(js::render_quad(
                FG_CANVAS_IX,
                0,
                y as usize,
                0,
                self.state.conf.grid_height(),
                "selection-box",
                None,
            ))
        } else {
            self.state.selection_box_dom_id = None;
        }

        let x = self.set_cursor_pos(self.state.conf.px_to_beat(x)) as usize;
        self.state.cursor_moving = true;
        self.state.mouse_down = true;
        self.state.mouse_down_x = x;
        self.state.mouse_down_y = self.state.conf.grid_height() - 2;

        return;
    }

    pub fn copy_selected_notes(&mut self) {
        let (earliest_start_beat, latest_end_beat) = self.state.selected_notes.iter().fold(
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

        let offset_beats = self.state.cursor_pos_beats - earliest_start_beat;

        let cur_selected_notes = self.state.selected_notes.drain().collect::<Vec<_>>();
        let mut new_selected_notes = FnvHashSet::default();
        new_selected_notes.reserve(self.state.selected_notes.len());

        trace!(
            "Copying {} selected notes...",
            self.state.selected_notes.len()
        );
        for SelectedNoteData {
            start_beat,
            width,
            line_ix,
            dom_id,
        } in cur_selected_notes
        {
            R::deselect_note(dom_id);
            let new_start_beat = start_beat + offset_beats;
            let new_end_beat = start_beat + width + offset_beats;
            // try to insert a note `offset_beats` away from the previous note on the same line
            if let skip_list::Bounds::Bounded(start_bound, end_bound_opt) = self
                .state
                .data
                .get_bounds(line_ix, new_start_beat + (width / 0.5))
            {
                if start_bound > new_start_beat
                    || (end_bound_opt
                        .map(|end_bound| end_bound < new_end_beat)
                        .unwrap_or(false))
                {
                    trace!("Unable to place a note at this location due to collision");
                    continue;
                }
            }

            let new_dom_id = self.render_note(line_ix, new_start_beat, width);
            let new_note = NoteBox {
                bounds: NoteBoxBounds {
                    start_beat: start_beat + offset_beats,
                    end_beat: start_beat + width + offset_beats,
                },
                data: self.handler.create_note(
                    &mut self.state,
                    line_ix,
                    new_start_beat,
                    new_dom_id,
                ),
            };

            let selected_note_data = SelectedNoteData::from_note_box(line_ix, &new_note);
            trace!(
                "Attempting to insert copied note at: line_id: {}, span: {:?}",
                line_ix,
                new_note
            );
            match self.state.data.insert(line_ix, new_note) {
                Some(conflicting_note) => {
                    trace!(
                        "Failed to create note while copying; an existing note intersects it: {:?}",
                        conflicting_note
                    );
                    js::delete_element(new_dom_id);
                },
                None => {
                    trace!("Success.  Rendering + selecting.");
                    new_selected_notes.insert(selected_note_data);
                    R::select_note(new_dom_id);
                },
            }
        }

        // deselect the old notes and select the new ones
        self.state.selected_notes = new_selected_notes;

        // move the cursor forward
        let clipboard_end_beat = tern(
            self.state.cursor_pos_beats < latest_end_beat,
            latest_end_beat,
            earliest_start_beat + offset_beats.abs(),
        );
        let clipboard_width_beats = clipboard_end_beat - earliest_start_beat;
        self.set_cursor_pos(self.state.cursor_pos_beats + clipboard_width_beats);
    }

    /// Computes the `NoteBox` for the note that's currently being drawn given the current pixel
    /// position of the mouse.  We respect both the beat bounds from `self.state.cur_note_bounds`
    /// as well as snapping to the start/end of the current interval.
    pub fn compute_note_box_data(&self, x: usize) -> NoteBoxData {
        let (low_bound, high_bound) = self.state.cur_note_bounds;
        let high_bound = high_bound.unwrap_or(f32::INFINITY);

        let source_beat = self.state.conf.px_to_beat(self.state.mouse_down_x);
        let source_interval = source_beat / self.state.conf.note_snap_beat_interval;
        let cur_beat = self.state.conf.px_to_beat(x);
        let cur_interval = cur_beat / self.state.conf.note_snap_beat_interval;

        let (start_interval, end_interval) = if source_interval > cur_interval {
            (cur_interval, source_interval)
        } else {
            (source_interval, cur_interval)
        };

        let mut start_beat = clamp(
            start_interval.trunc() * self.state.conf.note_snap_beat_interval,
            low_bound,
            high_bound,
        );
        let mut end_beat = clamp(
            end_interval.ceil() * self.state.conf.note_snap_beat_interval,
            low_bound,
            high_bound,
        );
        let mut width_beats = end_beat - start_beat;

        // If we're trying to draw a note immediately to the right of an existing note and are
        // dragging it left causing its width to get set to zero, try to preserve at least one
        // `note_snap_beat_interval` of size to the right if we have room for it.
        if width_beats == 0. && cur_beat <= source_beat {
            let start_interval = source_interval.trunc();
            start_beat = clamp(
                start_interval * self.state.conf.note_snap_beat_interval,
                low_bound,
                high_bound,
            );
            end_beat = clamp(
                start_beat + self.state.conf.note_snap_beat_interval,
                low_bound,
                high_bound,
            );
            width_beats = end_beat - start_beat
        }

        NoteBoxData {
            x: self.state.conf.beats_to_px(start_beat),
            width: self.state.conf.beats_to_px(width_beats),
        }
    }

    pub fn set_cursor_pos(&mut self, x_beats: f32) -> usize {
        let intervals = x_beats / self.state.conf.note_snap_beat_interval;
        let snapped_x_px = self
            .state
            .conf
            .beats_to_px(intervals * self.state.conf.note_snap_beat_interval);
        self.state.cursor_pos_beats = self.state.conf.px_to_beat(snapped_x_px);
        R::set_cursor_pos(self.state.cursor_dom_id, snapped_x_px);
        snapped_x_px
    }

    pub fn deselect_all_notes(&mut self) {
        for note_data in self.state.selected_notes.drain() {
            R::deselect_note(note_data.dom_id);
        }
    }

    /// Inserts all of the notes in the provided array of raw note data, rendering them
    /// as they are inserted into the internal skip list data structure as well.
    fn insert_raw_notes(&mut self, raw_notes: Vec<RawNoteData>) {
        for raw_note in raw_notes {
            let RawNoteData {
                line_ix,
                start_beat,
                width,
            } = raw_note;
            let dom_id = self.render_note(line_ix, start_beat, width);
            let note_state = self
                .handler
                .create_note(&mut self.state, line_ix, start_beat, dom_id);
            debug!(
                "Inserting note at line_ix: {}, start_beat: {}",
                line_ix, start_beat
            );
            let insertion_error = self.state.data.lines[line_ix as usize].insert(NoteBox {
                data: note_state,
                bounds: NoteBoxBounds {
                    start_beat,
                    end_beat: start_beat + width,
                },
            });
            debug_assert!(insertion_error.is_none());
        }
    }

    fn reset(&mut self) {
        let new_state = GridState::new(self.state.conf.clone());
        let old_state = mem::replace(&mut self.state, new_state);

        // Remove all notes from the DOM
        for note in old_state.data.iter() {
            let dom_id = note.note_box.data.get_id();
            js::delete_element(dom_id);
        }

        // Reset cursor to initial position
        self.set_cursor_pos(0.);
    }

    pub fn try_load_saved_composition(&mut self) {
        let base64_data: String = match js::get_localstorage_key(&self.get_state_key()) {
            Some(data) => data,
            None => return,
        };

        let decoded_bytes: Vec<u8> =
            base64::decode(&base64_data).expect("Invalid base64 was saved.");
        let raw_notes: Vec<RawNoteData> = bincode::deserialize(&decoded_bytes)
            .expect("Unable to decode saved composition from raw bytes.");

        self.insert_raw_notes(raw_notes);
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
            self.state.mouse_down_x,
            self.state.mouse_down_y,
            x,
            y.saturating_sub(self.state.conf.cursor_gutter_height),
            last_x,
            last_y.saturating_sub(self.state.conf.cursor_gutter_height),
        );
        R::set_selection_box(&self.state.conf, selection_box_dom_id, x, y, width, height);

        self.handler.on_selection_region_update(
            &mut self.state,
            &retained_region,
            &changed_region_1,
            &changed_region_2,
        );
    }

    fn init_selection_box(&mut self, x: usize, y: usize) -> Option<DomId> {
        self.deselect_all_notes();

        // TODO: make dedicated function in `render` probably
        Some(js::render_quad(
            FG_CANVAS_IX,
            x,
            y,
            0,
            0,
            "selection-box",
            None,
        ))
    }

    fn delete_selection_box(&mut self, selection_box_dom_id: usize) {
        js::delete_element(selection_box_dom_id);
        self.handler.on_selection_box_deleted(&mut self.state);
    }

    fn get_state_key(&self) -> String { format!("grid_{}", self.uuid) }

    fn serialize_and_save(&mut self) {
        // Get a list of every note in the composition matched with its line index
        let all_notes: Vec<RawNoteData> = self.state.get_raw_note_data();

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

        let state_key = self.get_state_key();
        js::set_localstorage_key(&state_key, base64_str);
    }
}
