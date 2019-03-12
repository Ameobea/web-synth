use std::{
    cmp::Ordering,
    hash::{Hash, Hasher},
    mem, ptr,
};

use fnv::FnvHashSet;
use rand::prelude::*;
use rand_pcg::Pcg32;

use super::prelude::*;

pub struct State {
    pub mouse_down: bool,
    pub cursor_moving: bool,
    pub mouse_down_x: usize,
    pub mouse_down_y: usize,
    pub drawing_note_dom_id: Option<usize>,
    /// (original_dragging_note_start_beat, SelectedNoteData)
    pub dragging_note_data: Option<(f32, SelectedNoteData)>,
    pub selection_box_dom_id: Option<usize>,
    pub note_lines: skip_list::NoteLines<usize>,
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
    pub synth: PolySynth,
    pub playback_active: bool,
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
            note_lines: skip_list::NoteLines::new(LINE_COUNT),
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
            synth: PolySynth::new(true),
            playback_active: false,
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
    pub fn from_note_box(line_ix: usize, note_box: &NoteBox<usize>) -> Self {
        SelectedNoteData {
            line_ix,
            dom_id: note_box.data,
            start_beat: note_box.bounds.start_beat,
            width: note_box.bounds.width(),
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
    let initial_state = box State::default();
    STATE = Box::into_raw(initial_state);

    skip_list::SKIP_LIST_NODE_DEBUG_POINTERS = Box::into_raw(box skip_list::blank_shortcuts());
}
