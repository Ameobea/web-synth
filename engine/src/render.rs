use super::*;

#[inline(always)]
pub fn select_note(dom_id: usize) { add_class(dom_id, "selected"); }

#[inline(always)]
pub fn deselect_note(dom_id: usize) { remove_class(dom_id, "selected"); }

pub fn set_cursor_pos(x: usize) -> f32 {
    state().cursor_pos = px_to_beat(x as f32);
    let note_snap_beat_interval_px = beats_to_px(NOTE_SNAP_BEAT_INTERVAL);
    let intervals = ((x as f32) / note_snap_beat_interval_px).round();
    let x = intervals * note_snap_beat_interval_px;
    let x_str = (x as usize).to_string();
    set_attr(state().cursor_dom_id, "x1", &x_str);
    set_attr(state().cursor_dom_id, "x2", &x_str);
    x
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
        render_line(FG_CANVAS_IX, x, 0., x, GRID_HEIGHT as f32, "measure-line");
        for j in 1..4 {
            let x = x + ((MEASURE_WIDTH_PX / 4.) * j as f32);
            render_line(FG_CANVAS_IX, x, 0., x, GRID_HEIGHT as f32, "beat-line");
        }
    }
}

#[inline(always)]
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

#[inline(always)]
pub fn draw_cursor() -> usize {
    render_line(
        FG_CANVAS_IX,
        state().cursor_pos,
        0.0,
        state().cursor_pos,
        GRID_HEIGHT as f32,
        "cursor",
    )
}
