use std::{
    cmp::Ordering,
    hash::{Hash, Hasher},
    mem, ptr,
};

use fnv::FnvHashSet;
use rand::prelude::*;
use rand_pcg::Pcg32;
use slab::Slab;

use super::{note_box::NoteBox, skip_list::*};

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

pub struct State {
    pub mouse_down: bool,
    pub cursor_moving: bool,
    pub mouse_down_x: usize,
    pub mouse_down_y: usize,
    pub drawing_note_dom_id: Option<usize>,
    /// (original_dragging_note_start_beat, SelectedNoteData)
    pub dragging_note_data: Option<(f32, SelectedNoteData)>,
    pub selection_box_dom_id: Option<usize>,
    pub notes: Slab<NoteBox>,
    pub nodes: Slab<NoteSkipListNode>,
    pub note_lines: NoteLines,
    pub rng: Pcg32,
    pub cur_note_bounds: (f32, Option<f32>),
    // TODO: Make this something better, like mapping dom_id to line index and start beat or sth.
    pub selected_notes: FnvHashSet<SelectedNoteData>,
    pub cur_tool: Tool,
    pub control_pressed: bool,
    pub shift_pressed: bool,
    pub mouse_x: usize,
    pub mouse_y: usize,
    pub cursor_pos_beats: f32,
    pub cursor_dom_id: usize,
}

impl Default for State {
    fn default() -> Self {
        State {
            mouse_down: false,
            cursor_moving: false,
            mouse_down_x: 0,
            mouse_down_y: 0,
            drawing_note_dom_id: None,
            dragging_note_data: None,
            selection_box_dom_id: None,
            notes: Slab::new(),
            nodes: Slab::new(),
            note_lines: NoteLines::new(LINE_COUNT),
            rng: Pcg32::from_seed(unsafe { mem::transmute(128u128) }),
            cur_note_bounds: (0.0, None),
            selected_notes: FnvHashSet::default(),
            cur_tool: Tool::DrawNote,
            control_pressed: false,
            shift_pressed: false,
            mouse_x: 0,
            mouse_y: 0,
            cursor_pos_beats: 0.0,
            cursor_dom_id: 0,
        }
    }
}

#[thread_local]
pub static mut STATE: *mut State = ptr::null_mut();

pub fn state() -> &'static mut State { unsafe { &mut *STATE } }

#[derive(Clone, Copy, Debug)]
pub struct SelectedNoteData {
    pub line_ix: usize,
    pub dom_id: usize,
    pub start_beat: f32,
    pub width: f32,
}

impl PartialEq for SelectedNoteData {
    fn eq(&self, other: &Self) -> bool { self.dom_id == other.dom_id }
}

impl Eq for SelectedNoteData {}

// Since `dom_id` is guarenteed to be unique, we can skip hashing the `line_ix` as an optimization.
impl Hash for SelectedNoteData {
    fn hash<H: Hasher>(&self, state: &mut H) { self.dom_id.hash(state) }
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
    fn cmp(&self, other: &Self) -> Ordering { self.partial_cmp(&other).unwrap() }
}

impl SelectedNoteData {
    pub fn from_note_box(line_ix: usize, note_box: &NoteBox) -> Self {
        SelectedNoteData {
            line_ix,
            dom_id: note_box.dom_id,
            start_beat: note_box.start_beat,
            width: note_box.width(),
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Tool {
    /// A new note will be drawn starting at wherever the mouse is pressed
    DrawNote,
    /// Any note clicked on will be deleted
    DeleteNote,
}

pub fn get_sorted_selected_notes(sort_reverse: bool) -> Vec<&'static SelectedNoteData> {
    let mut notes: Vec<&SelectedNoteData> = state().selected_notes.iter().collect::<Vec<_>>();

    if sort_reverse {
        notes.sort_unstable_by(|a, b| b.cmp(a));
    } else {
        notes.sort_unstable();
    }

    notes
}

pub unsafe fn init_state() {
    let created_state = box State::default();
    STATE = Box::into_raw(created_state) as *mut _;

    // Insert dummy values to ensure that we never have anything at index 0 and our `NonZero`
    // assumptions remain true.
    let note_slot_key = state().notes.insert(NoteBox {
        start_beat: 0.0,
        end_beat: 0.0,
        dom_id: 0,
    });
    assert_eq!(note_slot_key, 0);
    let placeholder_node_key = state().nodes.insert(NoteSkipListNode {
        val_slot_key: 0.into(),
        links: mem::zeroed(),
    });
    assert_eq!(placeholder_node_key, 0);

    SKIP_LIST_NODE_DEBUG_POINTERS = Box::into_raw(box blank_shortcuts());
}
