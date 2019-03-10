//! Functions for interacting with the DOM to render the UI

use super::prelude::{js::*, *};

pub fn select_note(dom_id: usize) { add_class(dom_id, "selected"); }

pub fn deselect_note(dom_id: usize) { remove_class(dom_id, "selected"); }

pub fn set_cursor_pos(x_beats: f32) -> f32 {
    let x_px = beats_to_px(x_beats);
    let note_snap_beat_interval_px = beats_to_px(NOTE_SNAP_BEAT_INTERVAL);
    let intervals = (x_px / note_snap_beat_interval_px).round();
    let snapped_x_px = intervals * note_snap_beat_interval_px;
    state().cursor_pos_beats = px_to_beat(snapped_x_px);
    let x_str = (snapped_x_px as usize).to_string();
    set_attr(state().cursor_dom_id, "x1", &x_str);
    set_attr(state().cursor_dom_id, "x2", &x_str);
    snapped_x_px
}

#[inline]
pub fn draw_grid_line(y: usize) {
    let class = tern(y % 2 == 0, "grid-line-1", "grid-line-2");

    render_quad(
        BG_CANVAS_IX,
        0.0,
        CURSOR_GUTTER_HEIGHT as f32 + (y * PADDED_LINE_HEIGHT) as f32,
        GRID_WIDTH as f32,
        LINE_HEIGHT as f32,
        class,
    );
}

/// This renders the background grid that contains the lines for the notes.  It is rendered to a
/// background SVG that doesn't change.
pub fn draw_grid() {
    for y in 0..LINE_COUNT {
        draw_grid_line(y);
    }
}

pub fn draw_measure_lines() {
    for i in 0..MEASURE_COUNT {
        let x: f32 = MEASURE_WIDTH_PX * (i as f32);
        if i != 0 {
            render_line(FG_CANVAS_IX, x, 0., x, GRID_HEIGHT as f32, "measure-line");
        }
        for j in 1..4 {
            let x = x + ((MEASURE_WIDTH_PX / 4.) * j as f32);
            render_line(FG_CANVAS_IX, x, 0., x, GRID_HEIGHT as f32, "beat-line");
        }
    }
}

pub fn draw_cursor_gutter() {
    render_quad(
        FG_CANVAS_IX,
        0.0,
        0.0,
        GRID_WIDTH as f32,
        CURSOR_GUTTER_HEIGHT as f32,
        "cursor-gutter",
    );
}

/// Draws a note on the canvas and returns its DOM id.

pub fn draw_note(line_ix: usize, start_px: f32, width_px: f32) -> usize {
    render_quad(
        FG_CANVAS_IX,
        start_px,
        (CURSOR_GUTTER_HEIGHT + (line_ix * PADDED_LINE_HEIGHT)) as f32,
        width_px,
        LINE_HEIGHT as f32,
        "note",
    )
}

pub fn draw_cursor() -> usize {
    render_line(
        FG_CANVAS_IX,
        state().cursor_pos_beats,
        0.0,
        state().cursor_pos_beats,
        GRID_HEIGHT as f32,
        "cursor",
    )
}
