//! Functions for interacting with the DOM to render the UI

use super::prelude::{js::*, *};

#[inline]
pub fn draw_grid_line(conf: &GridConf, y: usize) {
    let class = tern(y % 2 == 0, "grid-line-1", "grid-line-2");

    render_quad(
        BG_CANVAS_IX,
        0,
        CURSOR_GUTTER_HEIGHT + (y * PADDED_LINE_HEIGHT),
        conf.grid_width,
        LINE_HEIGHT,
        class,
    );
}

/// This renders the background grid that contains the lines for the notes.  It is rendered to a
/// background SVG that doesn't change.
pub fn draw_grid(conf: &GridConf) {
    for y in 0..LINE_COUNT {
        draw_grid_line(conf, y);
    }
}

pub fn draw_measure_lines(conf: &GridConf) {
    for i in 0..MEASURE_COUNT {
        let x = conf.measure_width_px * i;
        if i != 0 {
            render_line(FG_CANVAS_IX, x, 0, x, GRID_HEIGHT, "measure-line");
        }
        for j in 1..4 {
            let x = x + ((conf.measure_width_px / 4) * j);
            render_line(FG_CANVAS_IX, x, 0, x, GRID_HEIGHT, "beat-line");
        }
    }
}

pub fn draw_cursor_gutter(conf: &GridConf) {
    render_quad(
        FG_CANVAS_IX,
        0,
        0,
        conf.measure_width_px,
        CURSOR_GUTTER_HEIGHT,
        "cursor-gutter",
    );
}
