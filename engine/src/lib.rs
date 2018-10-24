#![feature(box_syntax, test, slice_patterns, nll, thread_local)]

extern crate common;
extern crate fnv;
extern crate rand;
extern crate rand_pcg;
extern crate slab;
extern crate test;
extern crate wasm_bindgen;

use std::cmp::Ordering;
use std::fmt::{self, Debug, Formatter};
use std::mem;
use std::ptr;

use fnv::FnvHashSet;
use rand::prelude::*;
use rand_pcg::Pcg32;
use slab::Slab;
use wasm_bindgen::prelude::*;

pub mod selection_box;
pub mod skip_list;
use self::selection_box::*;
use self::skip_list::*;

#[wasm_bindgen(module = "./index")]
extern "C" {
    pub fn render_quad(
        canvas_index: usize,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        class: &str,
    ) -> usize;
    pub fn render_line(
        canvas_index: usize,
        x1: f32,
        y1: f32,
        x2: f32,
        y2: f32,
        class: &str,
    ) -> usize;
    pub fn get_active_attr(key: &str) -> Option<String>;
    pub fn set_active_attr(key: &str, val: &str);
    pub fn set_attr(id: usize, key: &str, val: &str);
    pub fn get_attr(id: usize, key: &str) -> Option<String>;
    pub fn del_attr(id: usize, key: &str);
    pub fn add_class(id: usize, className: &str);
    pub fn remove_class(id: usize, className: &str);
    pub fn delete_element(id: usize);
}

/// Height of one of the lines rendered in the grid
pub const LINE_HEIGHT: usize = 12;
pub const NOTES_PER_OCTAVE: usize = 12; // A,Bb,B,C,C#,D,Eb,E,F,F#,G,Ab
pub const OCTAVES: usize = 5;
pub const LINE_COUNT: usize = OCTAVES * NOTES_PER_OCTAVE;
pub const LINE_BORDER_WIDTH: usize = 1;
pub const PADDED_LINE_HEIGHT: usize = LINE_HEIGHT + LINE_BORDER_WIDTH;
pub const GRID_HEIGHT: usize = LINE_COUNT * PADDED_LINE_HEIGHT - 1;
/// How long one beat is in pixels
pub const BEAT_LENGTH_PX: f32 = 20.0;
pub const MEASURE_COUNT: usize = 16;
pub const BEATS_PER_MEASURE: usize = 4;
pub const MEASURE_WIDTH_PX: f32 = BEATS_PER_MEASURE as f32 * BEAT_LENGTH_PX;
pub const GRID_WIDTH: usize = MEASURE_COUNT * (MEASURE_WIDTH_PX as usize);
pub const BG_CANVAS_IX: usize = 0;
pub const FG_CANVAS_IX: usize = 1;
pub const NOTE_SKIP_LIST_LEVELS: usize = 5;

pub struct MouseDownData {
    pub down: bool,
    pub x: usize,
    pub y: usize,
    pub note_dom_id: Option<usize>,
    pub selection_box_dom_id: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SelectedNoteData {
    pub line_ix: usize,
    pub dom_id: usize,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Tool {
    /// A new note will be drawn starting at wherever the mouse is pressed
    DrawNote,
    /// Any note clicked on will be deleted
    DeleteNote,
}

// All of the statics are made thread local so that multiple tests can run concurrently without
// causing all kinds of horrible async UB stuff.
#[thread_local]
pub static mut MOUSE_DOWN_DATA: MouseDownData = MouseDownData {
    down: false,
    x: 0,
    y: 0,
    note_dom_id: None,
    selection_box_dom_id: None,
};
#[thread_local]
pub static mut NOTE_BOXES: *mut Slab<NoteBox> = ptr::null_mut();
#[thread_local]
pub static mut NOTE_SKIPLIST_NODES: *mut Slab<NoteSkipListNode> = ptr::null_mut();
/// Represents the position of all of the notes on all of the lines, providing efficient operations
/// for determining bounds, intersections with beats, etc.
#[thread_local]
pub static mut NOTE_LINES: *mut NoteLines = ptr::null_mut();
#[thread_local]
pub static mut RNG: *mut Pcg32 = ptr::null_mut();
#[thread_local]
pub static mut CUR_NOTE_BOUNDS: (f32, Option<f32>) = (0.0, None);
#[thread_local]
pub static mut SELECTED_NOTES: *mut FnvHashSet<SelectedNoteData> = ptr::null_mut();
#[thread_local]
pub static mut CUR_TOOL: Tool = Tool::DrawNote;
#[thread_local]
pub static mut CONTROL_PRESSED: bool = false;
#[thread_local]
pub static mut SHIFT_PRESSED: bool = false;
#[thread_local]
pub static mut CUR_MOUSE_COORDS: (usize, usize) = (0, 0);

#[inline(always)]
pub fn notes() -> &'static mut Slab<NoteBox> {
    unsafe { &mut *NOTE_BOXES }
}

#[inline(always)]
pub fn nodes() -> &'static mut Slab<NoteSkipListNode> {
    unsafe { &mut *NOTE_SKIPLIST_NODES }
}

#[inline(always)]
pub fn lines() -> &'static mut NoteLines {
    unsafe { &mut *NOTE_LINES }
}

#[inline(always)]
pub fn bounds() -> (f32, Option<f32>) {
    unsafe { CUR_NOTE_BOUNDS }
}

#[inline(always)]
fn mouse_down() -> bool {
    unsafe { MOUSE_DOWN_DATA.down }
}

fn select_note(dom_id: usize) {
    add_class(dom_id, "selected")
}

fn deselect_note(dom_id: usize) {
    remove_class(dom_id, "selected")
}

#[wasm_bindgen]
pub enum Note {
    A,
    Bb,
    B,
    C,
    Cs,
    D,
    Eb,
    E,
    F,
    Fs,
    G,
    Ab,
}

#[derive(Clone, Copy, PartialEq)]
pub struct NoteBox {
    pub start_beat: f32,
    pub end_beat: f32,
    pub dom_id: usize,
}

impl Debug for NoteBox {
    fn fmt(&self, fmt: &mut Formatter) -> Result<(), fmt::Error> {
        write!(fmt, "|{}, {}|", self.start_beat, self.end_beat)
    }
}

impl Eq for NoteBox {}

impl PartialOrd for NoteBox {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        if self.start_beat > other.end_beat {
            Some(Ordering::Greater)
        } else if self.end_beat < other.start_beat {
            Some(Ordering::Less)
        } else {
            None
        }
    }
}

impl Ord for NoteBox {
    fn cmp(&self, other: &Self) -> Ordering {
        if self.start_beat > other.end_beat {
            Ordering::Greater
        } else if self.end_beat < other.start_beat {
            Ordering::Less
        } else if self.start_beat > other.start_beat {
            Ordering::Greater
        } else {
            Ordering::Less
        }
    }
}

impl NoteBox {
    #[inline(always)]
    pub fn contains(&self, beat: f32) -> bool {
        self.start_beat <= beat && self.end_beat >= beat
    }

    /// Same as `NoteBox::contains` except edges exactly touching don't count.
    pub fn contains_exclusive(&self, beat: f32) -> bool {
        self.start_beat < beat && self.end_beat > beat
    }

    #[inline(always)]
    pub fn intersects(&self, other: &Self) -> bool {
        other.contains(self.start_beat)
            || other.contains(self.end_beat)
            || self.contains(other.start_beat)
            || self.contains(other.end_beat)
    }

    /// Same as `NoteBox::intersects` except edges exactly touching don't count.
    pub fn intersects_exclusive(&self, other: &Self) -> bool {
        other.contains_exclusive(self.start_beat)
            || other.contains_exclusive(self.end_beat)
            || self.contains_exclusive(other.start_beat)
            || self.contains_exclusive(other.end_beat)
    }
}

pub unsafe fn init_state() {
    NOTE_BOXES = Box::into_raw(box Slab::new());
    NOTE_SKIPLIST_NODES = Box::into_raw(box Slab::new());

    // Insert dummy values to ensure that we never have anything at index 0 and our `NonZero`
    // assumptions remain true.
    let note_slot_key = notes().insert(NoteBox {
        start_beat: 0.0,
        end_beat: 0.0,
        dom_id: 0,
    });
    assert_eq!(note_slot_key, 0);
    let placeholder_node_key = nodes().insert(NoteSkipListNode {
        val_slot_key: 0.into(),
        links: mem::zeroed(),
    });
    assert_eq!(placeholder_node_key, 0);

    NOTE_LINES = Box::into_raw(box NoteLines::new(LINE_COUNT));
    RNG = Box::into_raw(box Pcg32::from_seed(mem::transmute(0u128)));
    SKIP_LIST_NODE_DEBUG_POINTERS = Box::into_raw(box blank_shortcuts());
    SELECTED_NOTES = Box::into_raw(box FnvHashSet::default());
}

#[inline]
fn draw_grid_line(y: usize) {
    let class = if y % 2 == 0 {
        "grid-line-1"
    } else {
        "grid-line-2"
    };

    render_quad(
        BG_CANVAS_IX,
        0.0,
        (y * PADDED_LINE_HEIGHT) as f32,
        GRID_WIDTH as f32,
        LINE_HEIGHT as f32,
        class,
    );
}

/// This renders the background grid that contains the lines for the notes.  It is rendered to a
/// background SVG that doesn't change.
fn draw_grid() {
    for y in 0..LINE_COUNT {
        draw_grid_line(y);
    }
}

fn draw_measure_lines() {
    for i in 0..MEASURE_COUNT {
        let x: f32 = MEASURE_WIDTH_PX * (i as f32);
        render_line(FG_CANVAS_IX, x, 0., x, GRID_HEIGHT as f32, "measure-line");
    }
}

#[inline(always)]
fn get_line_index(y: usize) -> usize {
    (y as f32 / (PADDED_LINE_HEIGHT as f32)).trunc() as usize
}

#[inline(always)]
pub fn px_to_beat(px: f32) -> f32 {
    px / BEAT_LENGTH_PX
}

#[inline(always)]
pub fn beats_to_px(beats: f32) -> f32 {
    beats * BEAT_LENGTH_PX
}

#[wasm_bindgen]
pub fn draw_note(note: Note, octave: usize, start_beat: f32, end_beat: f32) {
    let note_line_ix = LINE_COUNT - ((octave * NOTES_PER_OCTAVE) + (note as usize));
    let start_x = start_beat * BEAT_LENGTH_PX;
    let width = (end_beat * BEAT_LENGTH_PX) - start_x;
    render_quad(
        FG_CANVAS_IX,
        start_x,
        (note_line_ix * PADDED_LINE_HEIGHT) as f32,
        width,
        LINE_HEIGHT as f32,
        "note",
    );
}

#[inline(always)]
fn clamp(val: usize, min: f32, max: Option<f32>) -> usize {
    let fval = val as f32;
    match max {
        _ if fval < min => min as usize,
        Some(max) if fval > max => max as usize,
        _ => val,
    }
}

pub struct NoteBoxData {
    pub width: usize,
    pub x: usize,
}

impl NoteBoxData {
    pub fn compute(x: usize) -> Self {
        let (low_bound, high_bound) = bounds();
        let x = clamp(x, beats_to_px(low_bound), high_bound.map(beats_to_px));

        let down_x = unsafe { MOUSE_DOWN_DATA.x };
        let (minx, maxx) = if x < down_x { (x, down_x) } else { (down_x, x) };
        let width = maxx - minx;

        NoteBoxData { x: minx, width }
    }
}

#[wasm_bindgen]
pub fn handle_mouse_down(x: usize, y: usize) {
    let note_lines = lines();
    let selected_notes = unsafe { &mut *SELECTED_NOTES };
    let cur_tool = unsafe { CUR_TOOL };
    let ctrl_pressed = unsafe { CONTROL_PRESSED };
    let shift_pressed = unsafe { SHIFT_PRESSED };

    // Determine if the requested location intersects an existing note and if not, determine the
    // bounds on the note that will be drawn next.
    let line_ix = get_line_index(y);
    let beat = px_to_beat(x as f32);
    let bounds = note_lines.get_bounds(line_ix, beat);
    let mut drawing_dom_id = None;
    let mut selection_box_dom_id = None;

    let mut draw_selection_box = || {
        selection_box_dom_id = Some(render_quad(
            FG_CANVAS_IX,
            x as f32,
            y as f32,
            0.0,
            0.0,
            "selection-box",
        ));
    };

    match bounds {
        Bounds::Intersecting(node) => match cur_tool {
            Tool::DrawNote if ctrl_pressed => {
                let dom_id = node.val_slot_key.dom_id;
                let selected_data = SelectedNoteData { line_ix, dom_id };

                if selected_notes.contains(&selected_data) {
                    deselect_note(dom_id);
                    selected_notes.remove(&selected_data);
                } else {
                    selected_notes.insert(selected_data);
                    select_note(dom_id);
                }
            }
            Tool::DrawNote if shift_pressed => draw_selection_box(),
            Tool::DeleteNote => {
                let dom_id = node.val_slot_key.dom_id;
                selected_notes.remove(&SelectedNoteData { line_ix, dom_id });
                lines().remove_by_dom_id(line_ix, dom_id);
            }
            Tool::DrawNote => {
                let NoteBox { dom_id, .. } = *node.val_slot_key;

                let mut select_new: bool = true;
                // Deselect all selected notes
                for SelectedNoteData {
                    dom_id: selected_dom_id,
                    ..
                } in selected_notes.drain()
                {
                    deselect_note(selected_dom_id);
                    if selected_dom_id == dom_id {
                        select_new = false;
                    }
                }
                if !select_new {
                    return;
                }

                // Select the clicked note since it wasn't previously selected
                selected_notes.insert(SelectedNoteData { dom_id, line_ix });
                add_class(dom_id, "selected");
            }
        },
        Bounds::Bounded(lower, upper) => match cur_tool {
            Tool::DrawNote if ctrl_pressed => {} // TODO
            Tool::DrawNote if shift_pressed => draw_selection_box(),
            Tool::DrawNote => {
                unsafe { CUR_NOTE_BOUNDS = (lower, upper) };

                // Draw the temporary/candidate note after storing its bounds
                drawing_dom_id = Some(render_quad(
                    FG_CANVAS_IX,
                    x as f32,
                    line_ix as f32 * PADDED_LINE_HEIGHT as f32,
                    0.0,
                    LINE_HEIGHT as f32,
                    "note",
                ));
            }
            _ => (),
        },
    };

    unsafe {
        MOUSE_DOWN_DATA = MouseDownData {
            down: true,
            x,
            y,
            note_dom_id: drawing_dom_id,
            selection_box_dom_id,
        };
    }
}

#[wasm_bindgen]
pub fn handle_mouse_move(x: usize, y: usize) {
    let (last_x, last_y) = unsafe { CUR_MOUSE_COORDS };
    unsafe { CUR_MOUSE_COORDS = (x, y) };
    if !mouse_down() {
        return;
    }
    let shift_pressed = unsafe { SHIFT_PRESSED };
    let &mut MouseDownData {
        note_dom_id,
        selection_box_dom_id,
        ..
    } = unsafe { &mut MOUSE_DOWN_DATA };
    let cur_tool = unsafe { CUR_TOOL };
    let selected_notes = unsafe { &mut *SELECTED_NOTES };

    match cur_tool {
        Tool::DrawNote if shift_pressed => {
            let selection_box_dom_id = match selection_box_dom_id {
                Some(id) => id,
                None => return,
            };

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
            } = SelectionBoxData::compute(x, y, last_x, last_y);
            set_attr(selection_box_dom_id, "x", &x.to_string());
            set_attr(selection_box_dom_id, "y", &y.to_string());
            set_attr(selection_box_dom_id, "width", &width.to_string());
            set_attr(selection_box_dom_id, "height", &height.to_string());
            // render_quad(
            //     1,
            //     changed_region_1.region.x as f32,
            //     changed_region_1.region.y as f32,
            //     changed_region_1.region.width as f32,
            //     changed_region_1.region.height as f32,
            //     if changed_region_1.was_added {
            //         "added"
            //     } else {
            //         "removed "
            //     },
            // );
            // render_quad(
            //     1,
            //     changed_region_2.region.x as f32,
            //     changed_region_2.region.y as f32,
            //     changed_region_2.region.width as f32,
            //     changed_region_2.region.height as f32,
            //     if changed_region_2.was_added {
            //         "added"
            //     } else {
            //         "removed "
            //     },
            // );

            // Look for all notes in the added/removed regions and add/remove them from the
            // selected notes set and select/deselect their UI representations
            // common::log(format!("Retained region: {:?}", retained_region));
            // common::log(format!(
            //     "Changed regions: {:?}, {:?}",
            //     changed_region_1, changed_region_2
            // ));
            for (was_added, region) in [
                (changed_region_1.was_added, changed_region_1.region),
                (changed_region_2.was_added, changed_region_2.region),
            ]
            .into_iter()
            {
                // common::log(format!("added: {}, region: {:?}", was_added, region));
                for note_data in lines().iter_region(region) {
                    // common::log(format!("Note: {:?}", note_data));
                    // Ignore notes that are also contained in the retained region
                    if let Some(retained_region) = retained_region.as_ref() {
                        if note_data.intersects_region(&retained_region) {
                            // common::log("Intersects retained region; skipping.");
                            continue;
                        }
                    }

                    let dom_id = note_data.note_box.dom_id;
                    let selected_note_data = note_data.into();
                    if *was_added && selected_notes.insert(selected_note_data) {
                        // common::log("Newly selected; selecting...");
                        select_note(dom_id);
                    } else if !*was_added && selected_notes.remove(&selected_note_data) {
                        // common::log("Newly deselected; deselecting...");
                        deselect_note(dom_id);
                    }
                }
            }
        }
        Tool::DrawNote => {
            if let Some(dom_id) = note_dom_id {
                let NoteBoxData { x, width } = NoteBoxData::compute(x);
                set_attr(dom_id, "x", &x.to_string());
                set_attr(dom_id, "width", &width.to_string());
            }
        }
        _ => (),
    }
}

#[wasm_bindgen]
pub fn handle_mouse_up(x: usize, _y: usize) {
    // if `MOUSE_DOWN` is not set, the user tried to place an invalid note and we ignore it.
    if !mouse_down() {
        return;
    }
    let &mut MouseDownData {
        ref mut down,
        y,
        note_dom_id,
        selection_box_dom_id,
        ..
    } = unsafe { &mut MOUSE_DOWN_DATA };
    *down = false;

    if unsafe { CUR_TOOL } == Tool::DrawNote {
        match (note_dom_id, selection_box_dom_id) {
            (Some(note_dom_id), None) => {
                let NoteBoxData { x, width } = NoteBoxData::compute(x);
                let x_px = x as f32;
                let y_px = y;
                let line_ix = get_line_index(y_px);
                let note = NoteBox {
                    dom_id: note_dom_id,
                    start_beat: px_to_beat(x_px),
                    end_beat: px_to_beat(x_px + width as f32),
                };

                // Actually insert the node into the skip list
                lines().insert(line_ix, note);
                // common::log(format!("{:?}", lines().lines[line_ix]));
            }
            (None, Some(selection_box_dom_id)) => delete_element(selection_box_dom_id),
            (Some(_), Some(_)) => common::error(
                "Both `note_dom_id` and `selection_box_dom_id` exist in `MOUSE_DOWN_DATA`!",
            ),
            (None, None) => (),
        }
    }
}

#[wasm_bindgen]
pub fn handle_mouse_wheel(_ydiff: isize) {}

#[wasm_bindgen]
pub fn handle_key_down(key: &str, control_pressed: bool, shift_pressed: bool) {
    // TODO: Check for focus on the canvas either on the frontend or here
    let selected_notes = unsafe { &mut *SELECTED_NOTES };

    // Drains the selected notes collection and creates a new one after applying `f` to each of the
    // notes contained within it.
    fn map_selected_notes<F: Fn(SelectedNoteData) -> SelectedNoteData>(f: F) {
        unsafe { *SELECTED_NOTES = (&mut *SELECTED_NOTES).drain().map(f).collect() };
    };

    unsafe { CONTROL_PRESSED = control_pressed };
    unsafe { SHIFT_PRESSED = shift_pressed };

    match key {
        // Delete all currently selected notes
        "Backspace" | "Delete" => {
            for SelectedNoteData { line_ix, dom_id } in selected_notes.drain() {
                lines().remove_by_dom_id(line_ix, dom_id);
            }
        }
        "ArrowUp" | "w" => map_selected_notes(|note_data: SelectedNoteData| {
            let SelectedNoteData { line_ix, dom_id } = note_data;
            if line_ix == 0 {
                return note_data;
            }

            lines().move_note(line_ix, line_ix - 1, dom_id);
            SelectedNoteData {
                line_ix: line_ix - 1,
                dom_id,
            }
        }),
        "ArrowDown" | "s" => map_selected_notes(|note_data: SelectedNoteData| {
            let SelectedNoteData { line_ix, dom_id } = note_data;
            if line_ix == LINE_COUNT - 1 {
                return note_data;
            }

            lines().move_note(line_ix, line_ix + 1, dom_id);
            SelectedNoteData {
                line_ix: line_ix + 1,
                dom_id,
            }
        }),
        "ArrowRight" | "d" => {} // TODO
        "ArrowLeft" | "a" => {}  // TODO
        _ => (),
    }
}

#[wasm_bindgen]
pub fn handle_key_up(_key: &str, control_pressed: bool, shift_pressed: bool) {
    unsafe { CONTROL_PRESSED = control_pressed };
    unsafe { SHIFT_PRESSED = shift_pressed };
}

#[wasm_bindgen]
pub fn init() {
    common::set_panic_hook();
    unsafe { init_state() };
    draw_grid();
    draw_measure_lines();
}
