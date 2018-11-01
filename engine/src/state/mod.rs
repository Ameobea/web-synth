use std::cmp::Ordering;
use std::hash::{Hash, Hasher};
use std::mem;
use std::ptr;

use fnv::FnvHashSet;
use rand::prelude::*;
use rand_pcg::Pcg32;
use slab::Slab;

pub mod note_box;
pub use self::note_box::*;
use super::skip_list::{
    blank_shortcuts, NoteLines, NoteSkipListNode, SKIP_LIST_NODE_DEBUG_POINTERS,
};

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
pub const NOTE_SNAP_BEAT_INTERVAL: f32 = 1.0;
pub const CURSOR_GUTTER_HEIGHT: usize = 16;

// All of the statics are made thread local so that multiple tests can run concurrently without
// causing all kinds of horrible async UB stuff.
#[thread_local]
pub static mut MOUSE_DOWN_DATA: MouseDownData = MouseDownData {
    down: false,
    cursor_movement: false,
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
#[thread_local]
pub static mut CURSOR_POS: f32 = 0.0;
#[thread_local]
pub static mut CURSOR_DOM_ID: usize = 0;

pub struct MouseDownData {
    pub down: bool,
    pub cursor_movement: bool,
    pub x: usize,
    pub y: usize,
    pub note_dom_id: Option<usize>,
    pub selection_box_dom_id: Option<usize>,
}

#[derive(Clone, Copy, Debug)]
pub struct SelectedNoteData {
    pub line_ix: usize,
    pub dom_id: usize,
    pub start_beat: f32,
}

impl PartialEq for SelectedNoteData {
    fn eq(&self, other: &Self) -> bool {
        self.dom_id == other.dom_id
    }
}

impl Eq for SelectedNoteData {}

// Since `dom_id` is guarenteed to be unique, we can skip hashing the `line_ix` as an optimization.
impl Hash for SelectedNoteData {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.dom_id.hash(state)
    }
}

impl PartialOrd for SelectedNoteData {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        let ix_ordering = self.line_ix.cmp(&other.line_ix);
        let ordering = match ix_ordering {
            Ordering::Equal => self.start_beat.partial_cmp(&other.start_beat).unwrap(),
            _ => ix_ordering,
        };
        Some(ordering)
    }
}

impl Ord for SelectedNoteData {
    fn cmp(&self, other: &Self) -> Ordering {
        self.partial_cmp(&other).unwrap()
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Tool {
    /// A new note will be drawn starting at wherever the mouse is pressed
    DrawNote,
    /// Any note clicked on will be deleted
    DeleteNote,
}

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
