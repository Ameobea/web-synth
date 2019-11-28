use super::prelude::*;

pub fn draw_grid_line(conf: &GridConf, y: usize) {
    let class = tern(y % 2 == 0, "grid-line-1", "grid-line-2");

    js::render_quad(
        BG_CANVAS_IX,
        0,
        conf.cursor_gutter_height + (y * conf.padded_line_height()),
        conf.grid_width,
        conf.line_height,
        class,
        None,
    );
}

/// This renders the background grid that contains the lines for the notes.  It is rendered to a
/// background SVG that doesn't change.
pub fn draw_grid(conf: &GridConf) {
    for y in 0..conf.row_count {
        draw_grid_line(conf, y);
    }
}

pub fn draw_measure_lines(conf: &GridConf) {
    // TODO: Move `measure_count` into `GridConf`
    for i in 0..40 {
        let x = conf.measure_width_px * i;
        if i != 0 {
            js::render_line(FG_CANVAS_IX, x, 0, x, conf.grid_height(), "measure-line");
        }
        for j in 1..4 {
            let x = x + ((conf.measure_width_px / 4) * j);
            js::render_line(FG_CANVAS_IX, x, 0, x, conf.grid_height(), "beat-line");
        }
    }
}

pub fn draw_cursor_gutter(conf: &GridConf) {
    js::render_quad(
        FG_CANVAS_IX,
        0,
        0,
        conf.measure_width_px,
        conf.cursor_gutter_height,
        "cursor-gutter",
        None,
    );
}

/// Renders the initial grid with lines, measures, and the cursor gutter.
pub fn render_initial_grid(conf: &GridConf, vc_id: &str) {
    js::init_grid(vc_id);
    draw_cursor_gutter(conf);
    draw_grid(conf);
    draw_measure_lines(conf);
}
