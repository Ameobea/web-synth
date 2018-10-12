extern crate common;
extern crate wasm_bindgen;

use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "./index")]
extern "C" {
    pub fn render_quad(canvas_index: usize, x: f32, y: f32, width: f32, height: f32, class: &str);
    pub fn render_line(canvas_index: usize, x1: f32, y1: f32, x2: f32, y2: f32, class: &str);
}

/// Height of one of the lines rendered in the grid
const LINE_HEIGHT: usize = 12;
const NOTES_PER_OCTAVE: usize = 12; // A,Bb,B,C,C#,D,Eb,E,F,F#,G,Ab
const OCTAVES: usize = 5;
const LINE_COUNT: usize = OCTAVES * NOTES_PER_OCTAVE;
const GRID_HEIGHT: usize = LINE_COUNT * LINE_HEIGHT;
/// How long one beat is in pixels
const BEAT_LENGTH_PX: f32 = 20.0;
const MEASURE_COUNT: usize = 16;
const BEATS_PER_MEASURE: usize = 4;
const MEASURE_WIDTH_PX: f32 = BEATS_PER_MEASURE as f32 * BEAT_LENGTH_PX;
const GRID_WIDTH: usize = MEASURE_COUNT * (MEASURE_WIDTH_PX as usize);
const BG_CANVAS_IX: usize = 0;
const FG_CANVAS_IX: usize = 1;

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
        (y * LINE_HEIGHT) as f32,
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

#[wasm_bindgen]
pub fn draw_note(note: Note, octave: usize, start_beat: f32, end_beat: f32) {
    let note_line_ix = LINE_COUNT - ((octave * NOTES_PER_OCTAVE) + (note as usize));
    let start_x = start_beat * BEAT_LENGTH_PX;
    let width = (end_beat * BEAT_LENGTH_PX) - start_x;
    render_quad(
        FG_CANVAS_IX,
        start_x,
        (note_line_ix * LINE_HEIGHT) as f32,
        width,
        LINE_HEIGHT as f32,
        "note",
    );
}

#[wasm_bindgen]
pub fn init() {
    draw_grid();
    draw_measure_lines();
}
