#![feature(box_syntax, test, slice_patterns, nll)]

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
use self::skip_list::{NoteSkipListNode, SlabKey};

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

static mut MOUSE_DOWN: bool = false;
static mut MOUSE_DOWN_COORDS: (usize, usize) = (0, 0);
pub static mut NOTE_BOXES: *mut Slab<NoteBox> = ptr::null_mut();
pub static mut NOTE_SKIPLIST_NODES: *mut Slab<NoteSkipListNode> = ptr::null_mut();
/// Represents the position of all of the notes on all of the lines, providing efficient operations
/// for determining bounds, intersections with beats, etc.
static mut NOTE_LINES: *mut NoteLines = ptr::null_mut();
pub static mut RNG: *mut Pcg32 = ptr::null_mut();

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

struct NoteLines(Vec<Vec<NoteBox>>);

impl NoteLines {
    fn new(line_count: usize) -> Self {
        NoteLines(vec![Vec::new(); line_count])
    }

    /// Performs the guessing game on the collection, finding the index
    fn locate_index(&self, line_ix: usize, beat: f32) -> Option<usize> {
        let line = &self.0[line_ix];
        if line.is_empty() {
            return Some(0);
        }

        let mut lower_bound = 0;
        let mut higher_bound = line.len();
        let mut prev_guess = 0;
        while lower_bound != higher_bound {
            let guess = (lower_bound + higher_bound) / 2;
            // check if the guess index contains the search beat
            if guess == prev_guess && line[guess].start_beat <= beat && line[guess].end_beat >= beat
            {
                // envolping confirmed.
                return None;
            }

            prev_guess = guess;

            let lower_valid = guess == 0 || line[guess - 1].end_beat < beat;
            if !lower_valid {
                // too high
                higher_bound = guess;
                continue;
            }

            let higher_valid = guess == line.len() || line[guess].start_beat > beat;
            if !higher_valid {
                // too low
                lower_bound = guess;
                continue;
            }

            return Some(guess);
        }
        None
    }

    /// Finds other notes on the line that surround the given pixel position.  If `None` is
    /// returned, then the given pixel position is within a note already.  Otherwise, the end point
    /// of the preceeding note box and the start point of the following one will be returned.
    /// If there is no preceeding box, then `None` is returned (same for following).
    fn get_bounds(&self, line_ix: usize, beat: f32) -> Option<(Option<f32>, Option<f32>)> {
        let line = &self.0[line_ix];
        // Check if we're off the front of the back up front (commo cases)
        let first_note_start = line[0].start_beat;
        let last_note_end = line[line.len() - 1].end_beat;
        if beat < first_note_start {
            return Some((None, Some(first_note_start)));
        } else if beat > last_note_end {
            return Some((Some(last_note_end), None));
        }

        let niche_index = self.locate_index(line_ix, beat)?;

        Some((
            if niche_index > 0 {
                Some(line[niche_index - 1].end_beat)
            } else {
                None
            },
            if !line.is_empty() && niche_index < line.len() {
                Some(line[niche_index].start_beat)
            } else {
                None
            },
        ))
    }

    /// Adds a new note box to the given line index
    fn push(&mut self, line_ix: usize, note_box: NoteBox) {
        // TODO: actually properly handle out-of-order inserts.  We're doing this temporarily.
        self.0[line_ix].push(note_box);
    }
}

unsafe fn init_state() {
    NOTE_BOXES = Box::into_raw(box Slab::new());
    NOTE_SKIPLIST_NODES = Box::into_raw(box Slab::new());
    // insert dummy values to ensure that we never have anything at index 0 and our `NonZero`
    // assumptions remain true
    let note_slot_key: SlabKey<NoteBox> = (&mut *NOTE_BOXES)
        .insert(NoteBox {
            start_beat: 0.0,
            end_beat: 0.0,
        })
        .into();
    println!("{:?}", note_slot_key);
    assert_eq!(note_slot_key.key(), 0);
    let placeholder_node_key = (&mut *NOTE_SKIPLIST_NODES).insert(NoteSkipListNode {
        val_slot_key: note_slot_key,
        links: mem::uninitialized(),
    });
    assert_eq!(placeholder_node_key, 0);

    NOTE_LINES = Box::into_raw(box NoteLines::new(LINE_COUNT));
    RNG = Box::into_raw(box Pcg32::from_seed(mem::transmute(0u128)));
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

#[wasm_bindgen]
pub fn handle_mouse_down(x: usize, y: usize) {
    unsafe {
        MOUSE_DOWN = true;
        MOUSE_DOWN_COORDS = (x, y);
    }

    let line_ix = get_line_index(y);
    render_quad(
        FG_CANVAS_IX,
        x as f32,
        line_ix as f32 * (LINE_HEIGHT + LINE_BORDER_WIDTH) as f32,
        0.0,
        LINE_HEIGHT as f32,
        "note",
    );
}

struct NoteBoxData {
    pub width: usize,
    pub x: usize,
}

fn compute_note_box(x: usize) -> NoteBoxData {
    let down_x = unsafe { MOUSE_DOWN_COORDS.0 };
    let (minx, maxx) = if x < down_x { (x, down_x) } else { (down_x, x) };
    let width = maxx - minx;

    NoteBoxData { x: minx, width }
}

#[wasm_bindgen]
pub fn handle_mouse_up(x: usize, _y: usize) {
    unsafe { MOUSE_DOWN = false };

    let NoteBoxData { x, width } = compute_note_box(x);
    let x_px = x as f32;
    let y_px: usize = get_active_attr("y").unwrap().parse().unwrap();
    let line_ix = get_line_index(y_px);
    let note_box = NoteBox {
        start_beat: px_to_beat(x_px),
        end_beat: px_to_beat(x_px + width as f32),
    };
    // unsafe { (&mut *NOTES).push(note_box) };
    unsafe { (&mut *NOTE_LINES).push(line_ix, note_box) };
}

#[wasm_bindgen]
pub fn handle_mouse_move(x: usize, _y: usize) {
    if !unsafe { MOUSE_DOWN } {
        return;
    }

    let NoteBoxData { x, width } = compute_note_box(x);
    set_active_attr("x", &x.to_string());
    set_active_attr("width", &width.to_string());
}

#[wasm_bindgen]
pub fn handle_mouse_wheel(_ydiff: isize) {}

#[wasm_bindgen]
pub fn init() {
    unsafe { init_state() };
    draw_grid();
    draw_measure_lines();
}

#[test]
fn note_lines_index_location() {
    let mut lines = NoteLines::new(1);
    let mut mkbox = |start_beat: f32, end_beat: f32| {
        lines.push(
            0,
            NoteBox {
                start_beat,
                end_beat,
            },
        )
    };

    for (start_beat, end_beat) in &[
        (2.0, 10.0),
        (10.0, 12.0),
        (14.0, 18.0),
        (19.0, 24.0),
        (25.0, 25.0),
    ] {
        mkbox(*start_beat, *end_beat);
    }

    assert_eq!(lines.get_bounds(0, 5.0), None);
    assert_eq!(lines.get_bounds(0, 1.0), Some((None, Some(2.0))));
    assert_eq!(lines.get_bounds(0, 2.0), None);
    assert_eq!(lines.get_bounds(0, 10.0), None);
    assert_eq!(lines.get_bounds(0, 13.0), Some((Some(12.0), Some(14.0))));
    assert_eq!(lines.get_bounds(0, 24.2), Some((Some(24.0), Some(25.0))));
    assert_eq!(lines.get_bounds(0, 200.2), Some((Some(25.0), None)));
}
