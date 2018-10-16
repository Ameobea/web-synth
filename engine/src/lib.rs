#![feature(box_syntax, test, slice_patterns, nll, thread_local)]

extern crate common;
extern crate rand;
extern crate rand_pcg;
extern crate slab;
extern crate statrs;
extern crate test;
extern crate wasm_bindgen;

use std::cmp::Ordering;
use std::fmt::{self, Debug, Formatter};
use std::mem;
use std::ptr;

use rand::prelude::*;
use rand_pcg::Pcg32;
use slab::Slab;
use wasm_bindgen::prelude::*;

mod skip_list;
use self::skip_list::{
    blank_shortcuts, NoteLines, NoteSkipListNode, SKIP_LIST_NODE_DEBUG_POINTERS,
};

#[wasm_bindgen(module = "./index")]
extern "C" {
    pub fn render_quad(canvas_index: usize, x: f32, y: f32, width: f32, height: f32, class: &str);
    pub fn render_line(canvas_index: usize, x1: f32, y1: f32, x2: f32, y2: f32, class: &str);
    pub fn get_active_attr(key: &str) -> Option<String>;
    pub fn set_active_attr(key: &str, val: &str);
}

/// Height of one of the lines rendered in the grid
const LINE_HEIGHT: usize = 12;
const NOTES_PER_OCTAVE: usize = 12; // A,Bb,B,C,C#,D,Eb,E,F,F#,G,Ab
const OCTAVES: usize = 5;
const LINE_COUNT: usize = OCTAVES * NOTES_PER_OCTAVE;
const LINE_BORDER_WIDTH: usize = 1;
const GRID_HEIGHT: usize = LINE_COUNT * LINE_HEIGHT;
/// How long one beat is in pixels
const BEAT_LENGTH_PX: f32 = 20.0;
const MEASURE_COUNT: usize = 16;
const BEATS_PER_MEASURE: usize = 4;
const MEASURE_WIDTH_PX: f32 = BEATS_PER_MEASURE as f32 * BEAT_LENGTH_PX;
const GRID_WIDTH: usize = MEASURE_COUNT * (MEASURE_WIDTH_PX as usize);
const BG_CANVAS_IX: usize = 0;
const FG_CANVAS_IX: usize = 1;
pub const NOTE_SKIP_LIST_LEVELS: usize = 5;

// All of the statics are made thread local so taht multiple tests can run concurrently without
// causing all kinds of horrible async UB stuff.
#[thread_local]
static mut MOUSE_DOWN: bool = false;
#[thread_local]
static mut MOUSE_DOWN_COORDS: (usize, usize) = (0, 0);
#[thread_local]
pub static mut NOTE_BOXES: *mut Slab<NoteBox> = ptr::null_mut();
#[thread_local]
pub static mut NOTE_SKIPLIST_NODES: *mut Slab<NoteSkipListNode> = ptr::null_mut();
/// Represents the position of all of the notes on all of the lines, providing efficient operations
/// for determining bounds, intersections with beats, etc.
#[thread_local]
static mut NOTE_LINES: *mut NoteLines = ptr::null_mut();
#[thread_local]
pub static mut RNG: *mut Pcg32 = ptr::null_mut();
#[thread_local]
static mut CUR_NOTE_BOUNDS: (f32, Option<f32>) = (0.0, None);

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

unsafe fn init_state() {
    NOTE_BOXES = Box::into_raw(box Slab::new());
    NOTE_SKIPLIST_NODES = Box::into_raw(box Slab::new());

    // Insert dummy values to ensure that we never have anything at index 0 and our `NonZero`
    // assumptions remain true.
    let note_slot_key = notes().insert(NoteBox {
        start_beat: 0.0,
        end_beat: 0.0,
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
        (y * (LINE_HEIGHT + LINE_BORDER_WIDTH)) as f32,
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
    (y as f32 / ((LINE_HEIGHT + LINE_BORDER_WIDTH) as f32)).trunc() as usize
}

#[inline(always)]
fn px_to_beat(px: f32) -> f32 {
    px / BEAT_LENGTH_PX
}

#[inline(always)]
fn beats_to_px(beats: f32) -> f32 {
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
        (note_line_ix * (LINE_HEIGHT + LINE_BORDER_WIDTH)) as f32,
        width,
        LINE_HEIGHT as f32,
        "note",
    );
}

struct NoteBoxData {
    pub width: usize,
    pub x: usize,
}

impl NoteBoxData {
    pub fn compute(x: usize) -> Self {
        let (low_bound, high_bound) = bounds();
        let x = clamp(x, beats_to_px(low_bound), high_bound.map(beats_to_px));

        let down_x = unsafe { MOUSE_DOWN_COORDS.0 };
        let (minx, maxx) = if x < down_x { (x, down_x) } else { (down_x, x) };
        let width = maxx - minx;

        NoteBoxData { x: minx, width }
    }
}

#[inline(always)]
fn clamp(val: usize, min: f32, max: Option<f32>) -> usize {
    let fval = val as f32;
    if fval < min {
        return min as usize;
    } else if max.is_some() {
        let max = max.unwrap();
        if fval > max {
            return max as usize;
        }
    }

    val
}

#[wasm_bindgen]
pub fn handle_mouse_down(x: usize, y: usize) {
    let note_lines = lines();

    // Determine if the requested location intersects an existing note and if not, determine the
    // bounds on the note that will be drawn next.
    let line_ix = get_line_index(y);
    let beat = px_to_beat(x as f32);
    match note_lines.get_bounds(line_ix, beat) {
        Some(bounds) => {
            unsafe { CUR_NOTE_BOUNDS = bounds };
        }
        None => {
            // log("Invalid note placement - intersects an existing note.");
            return;
        }
    };

    unsafe {
        MOUSE_DOWN = true;
        MOUSE_DOWN_COORDS = (x, y);
    }

    // Draw the temporary/candidate note after storing its bounds
    render_quad(
        FG_CANVAS_IX,
        x as f32,
        line_ix as f32 * (LINE_HEIGHT + LINE_BORDER_WIDTH) as f32,
        0.0,
        LINE_HEIGHT as f32,
        "note",
    );
}

#[wasm_bindgen]
pub fn handle_mouse_move(x: usize, _y: usize) {
    if unsafe { !MOUSE_DOWN } {
        return;
    }

    let NoteBoxData { x, width } = NoteBoxData::compute(x);
    set_active_attr("x", &x.to_string());
    set_active_attr("width", &width.to_string());
}

#[wasm_bindgen]
pub fn handle_mouse_up(x: usize, _y: usize) {
    // if `MOUSE_DOWN` is not set, the user tried to place an invalid note and we ignore it.
    if unsafe { !MOUSE_DOWN } {
        return;
    }
    unsafe { MOUSE_DOWN = false };

    let NoteBoxData { x, width } = NoteBoxData::compute(x);
    let x_px = x as f32;
    let y_px = unsafe { MOUSE_DOWN_COORDS.1 };
    let line_ix = get_line_index(y_px);
    let note = NoteBox {
        start_beat: px_to_beat(x_px),
        end_beat: px_to_beat(x_px + width as f32),
    };

    // Actually insert the node into the skip list
    lines().insert(line_ix, note);
    // log(format!("{:?}", lines().lines[line_ix]));
}

#[wasm_bindgen]
pub fn handle_mouse_wheel(_ydiff: isize) {}

#[wasm_bindgen]
pub fn init() {
    unsafe { init_state() };
    draw_grid();
    draw_measure_lines();
}

#[cfg(test)]
fn mklines(notes: &[(f32, f32)]) -> NoteLines {
    unsafe { init_state() };
    let mut lines = NoteLines::new(1);
    let mut mkbox = |start_beat: f32, end_beat: f32| {
        lines.insert(
            0,
            NoteBox {
                start_beat,
                end_beat,
            },
        )
    };

    for (start_beat, end_beat) in notes {
        mkbox(*start_beat, *end_beat);
    }

    lines
}

#[test]
fn note_lines_bounds() {
    let mut lines = mklines(&[
        (2.0, 10.0),
        (10.0, 12.0),
        (14.0, 18.0),
        (19.0, 24.0),
        (25.0, 25.0),
    ]);

    assert_eq!(lines.get_bounds(0, 5.0), None);
    assert_eq!(lines.get_bounds(0, 1.0), Some((0.0, Some(2.0))));
    assert_eq!(lines.get_bounds(0, 2.0), None);
    assert_eq!(lines.get_bounds(0, 10.0), None);
    assert_eq!(lines.get_bounds(0, 13.0), Some((12.0, Some(14.0))));
    assert_eq!(lines.get_bounds(0, 24.2), Some((24.0, Some(25.0))));
    assert_eq!(lines.get_bounds(0, 200.2), Some((25.0, None)));
}

#[test]
fn note_lines_bounds_2() {
    let mut lines = mklines(&[(4.65, 7.35), (16.5, 18.8)]);

    assert_eq!(lines.get_bounds(0, 30.0), Some((18.8, None)));
    assert_eq!(lines.get_bounds(0, 10.95), Some((7.35, Some(16.5))));
}

#[test]
fn note_lines_bounds_3() {
    let mut lines = mklines(&[(5.0, 10.0)]);

    assert_eq!(lines.get_bounds(0, 20.0), Some((10.0, None)));
}
