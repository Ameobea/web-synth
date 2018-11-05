#![feature(box_syntax, test, slice_patterns, thread_local)]
#![allow(clippy::float_cmp)]

extern crate common;
extern crate fnv;
extern crate rand;
extern crate rand_pcg;
extern crate slab;
extern crate test;
extern crate wasm_bindgen;

use std::f32;

use wasm_bindgen::prelude::*;

pub mod note_box;
pub mod render;
pub mod selection_box;
pub mod skip_list;
pub mod state;
pub mod util;
use self::note_box::*;
use self::render::*;
use self::selection_box::*;
use self::skip_list::*;
use self::state::*;
use self::util::*;

#[wasm_bindgen(module = "./index")]
extern "C" {
    pub fn render_quad(
        canvas_index: usize,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        class: &str,
    ) -> usize;
    pub fn render_line(
        canvas_index: usize,
        x1: f32,
        y1: f32,
        x2: f32,
        y2: f32,
        class: &str,
    ) -> usize;
    pub fn get_active_attr(key: &str) -> Option<String>;
    pub fn set_active_attr(key: &str, val: &str);
    pub fn set_attr(id: usize, key: &str, val: &str);
    pub fn get_attr(id: usize, key: &str) -> Option<String>;
    pub fn del_attr(id: usize, key: &str);
    pub fn add_class(id: usize, className: &str);
    pub fn remove_class(id: usize, className: &str);
    pub fn delete_element(id: usize);
    pub fn trigger_attack(note: f32);
    pub fn trigger_release(note: f32);
    pub fn trigger_attack_release(note: f32, duration: f32);
    pub fn trigger_attack_release_multiple(notes: &[f32], duration: f32);
}

#[wasm_bindgen]
pub fn handle_mouse_down(mut x: usize, y: usize) {
    let mut drawing_dom_id = None;
    let mut selection_box_dom_id = None;
    let mut draw_selection_box = || {
        selection_box_dom_id = Some(render_quad(
            FG_CANVAS_IX,
            x as f32,
            y as f32,
            0.0,
            0.0,
            "selection-box",
        ));
    };

    // Determine if the requested location intersects an existing note and if not, determine the
    // bounds on the note that will be drawn next.
    let line_ix = match get_line_index(y) {
        Some(line_ix) => line_ix,
        None => {
            if state().shift_pressed {
                state().selection_box_dom_id = Some(render_quad(
                    FG_CANVAS_IX,
                    0.0,
                    y as f32,
                    0.0,
                    GRID_HEIGHT as f32,
                    "selection-box",
                ))
            } else {
                state().selection_box_dom_id = None;
            }

            let x = set_cursor_pos(x) as usize;
            state().cursor_moving = true;
            state().mouse_down = true;
            state().mouse_down_x = x;
            state().mouse_down_y = GRID_HEIGHT - 2;

            return;
        }
    };
    let beat = px_to_beat(x as f32);
    let bounds = state().note_lines.get_bounds(line_ix, beat);

    if state().cur_tool == Tool::DrawNote && !state().shift_pressed {
        trigger_attack(midi_to_frequency(line_ix));
    }

    let mut init_selection_box = || {
        for note_data in state().selected_notes.drain() {
            deselect_note(note_data.dom_id);
        }
        draw_selection_box();
    };

    match bounds {
        Bounds::Intersecting(node) => match state().cur_tool {
            Tool::DrawNote if state().shift_pressed => init_selection_box(),
            Tool::DeleteNote => {
                let &NoteBox {
                    start_beat, dom_id, ..
                } = &*node.val_slot_key;
                unimplemented!(); // TODO
                state().note_lines.remove(line_ix, start_beat);
            }
            Tool::DrawNote => {
                let NoteBox { dom_id, .. } = *node.val_slot_key;
                let selected_data = SelectedNoteData {
                    line_ix,
                    dom_id,
                    start_beat: node.val_slot_key.start_beat,
                };

                let select_new = if state().control_pressed {
                    if state().selected_notes.contains(&selected_data) {
                        deselect_note(dom_id);
                        state().selected_notes.remove(&selected_data);
                        false
                    } else {
                        true
                    }
                } else {
                    let mut select_new: bool = true;
                    // Deselect all selected notes
                    for note_data in state().selected_notes.drain() {
                        deselect_note(note_data.dom_id);
                        if note_data.dom_id == dom_id {
                            select_new = false;
                        }
                    }

                    select_new
                };

                if select_new {
                    // Select the clicked note since it wasn't previously selected
                    state().selected_notes.insert(selected_data);
                    select_note(dom_id);
                }
            }
        },
        Bounds::Bounded(lower, upper) => match state().cur_tool {
            Tool::DrawNote if state().control_pressed => {} // TODO
            Tool::DrawNote if state().shift_pressed => init_selection_box(),
            Tool::DrawNote => {
                let snapped_lower = snap_to_beat_interval(x, beats_to_px(lower));
                let snapped_upper = (snapped_lower + beats_to_px(NOTE_SNAP_BEAT_INTERVAL))
                    .min(beats_to_px(upper.unwrap_or(f32::INFINITY)));
                let width = snapped_upper - snapped_lower;
                state().cur_note_bounds = (lower, upper);

                // Draw the temporary/candidate note after storing its bounds
                drawing_dom_id = Some(render_quad(
                    FG_CANVAS_IX,
                    snapped_lower,
                    (CURSOR_GUTTER_HEIGHT + (line_ix * PADDED_LINE_HEIGHT)) as f32,
                    width,
                    LINE_HEIGHT as f32,
                    "note",
                ));
                x = snapped_lower as usize;
            }
            _ => (),
        },
    };

    state().mouse_down = true;
    state().cursor_moving = false;
    state().mouse_down_x = x;
    state().mouse_down_y = y;
    state().drawing_note_dom_id = drawing_dom_id;
    state().selection_box_dom_id = selection_box_dom_id;
}

#[wasm_bindgen]
pub fn handle_mouse_move(x: usize, y: usize) {
    let (last_x, last_y) = (state().mouse_x, state().mouse_y);
    state().mouse_x = x;
    state().mouse_y = y;
    if !state().mouse_down {
        return;
    }

    let update_selection_box = |selection_box_dom_id: usize, x: usize, y: usize| {
        let SelectionBoxData {
            region:
                SelectionRegion {
                    x,
                    y,
                    width,
                    height,
                },
            retained_region,
            changed_region_1,
            changed_region_2,
        } = SelectionBoxData::compute(
            x,
            y.saturating_sub(CURSOR_GUTTER_HEIGHT),
            last_x,
            last_y.saturating_sub(CURSOR_GUTTER_HEIGHT),
        );
        set_attr(selection_box_dom_id, "x", &x.to_string());
        set_attr(
            selection_box_dom_id,
            "y",
            &(y + CURSOR_GUTTER_HEIGHT).to_string(),
        );
        set_attr(selection_box_dom_id, "width", &width.to_string());
        set_attr(selection_box_dom_id, "height", &height.to_string());

        // Look for all notes in the added/removed regions and add/remove them from the
        // selected notes set and select/deselect their UI representations
        for (was_added, region) in [
            (changed_region_1.was_added, changed_region_1.region),
            (changed_region_2.was_added, changed_region_2.region),
        ]
        .into_iter()
        {
            for note_data in state().note_lines.iter_region(region) {
                // Ignore notes that are also contained in the retained region
                if let Some(retained_region) = retained_region.as_ref() {
                    if note_data.intersects_region(&retained_region) {
                        continue;
                    }
                }

                let dom_id = note_data.note_box.dom_id;
                let selected_note_data: SelectedNoteData = note_data.into();
                let line_ix = selected_note_data.line_ix;
                if *was_added && state().selected_notes.insert(selected_note_data) {
                    select_note(dom_id);
                    trigger_attack(midi_to_frequency(line_ix));
                } else if !*was_added && state().selected_notes.remove(&selected_note_data) {
                    deselect_note(dom_id);
                    trigger_release(midi_to_frequency(line_ix));
                }
            }
        }
    };

    if state().cursor_moving {
        state().mouse_y = 1;
        if let Some(selection_box_dom_id) = state().selection_box_dom_id {
            update_selection_box(selection_box_dom_id, x, 1);
        } else {
            set_cursor_pos(x);
        }
        return;
    }

    match state().cur_tool {
        Tool::DrawNote if state().shift_pressed => {
            if let Some(selection_box_dom_id) = state().selection_box_dom_id {
                update_selection_box(selection_box_dom_id, x, y);
            }
        }
        Tool::DrawNote => {
            if let Some(dom_id) = state().drawing_note_dom_id {
                let NoteBoxData { x, width } = NoteBoxData::compute(x);
                set_attr(dom_id, "x", &x.to_string());
                set_attr(dom_id, "width", &width.to_string());
            }
        }
        _ => (),
    }
}

#[wasm_bindgen]
pub fn handle_mouse_up(x: usize, _y: usize) {
    // if `MOUSE_DOWN` is not set, the user tried to place an invalid note and we ignore it.
    if !state().mouse_down {
        return;
    }
    state().mouse_down = false;

    let delete_selection_box = |selection_box_dom_id: usize| {
        delete_element(selection_box_dom_id);

        for note_data in state().selected_notes.iter() {
            trigger_release(midi_to_frequency(note_data.line_ix));
        }
    };

    if state().cursor_moving {
        if let Some(selection_box_dom_id) = state().selection_box_dom_id {
            delete_selection_box(selection_box_dom_id);
        }

        set_cursor_pos(x);
        return;
    }

    let down_line_ix = get_line_index(state().mouse_down_y).unwrap();

    if let Some(selection_box_dom_id) = state().selection_box_dom_id {
        delete_selection_box(selection_box_dom_id);
    } else {
        trigger_release(midi_to_frequency(down_line_ix));
    }

    if state().cur_tool == Tool::DrawNote {
        match (state().drawing_note_dom_id, state().selection_box_dom_id) {
            (Some(note_dom_id), None) => {
                let NoteBoxData { x, width } = NoteBoxData::compute(x);
                if width == 0 {
                    return;
                }

                let x_px = x as f32;
                let start_beat = px_to_beat(x_px);
                let line_ix = down_line_ix;
                let note = NoteBox {
                    dom_id: note_dom_id,
                    start_beat,
                    end_beat: px_to_beat(x_px + width as f32),
                };

                // Actually insert the node into the skip list
                state().note_lines.insert(line_ix, note);
                if cfg!(debug_assertions) {
                    common::log(format!("{:?}", state().note_lines.lines[line_ix]));
                }

                for note_data in state().selected_notes.drain() {
                    deselect_note(note_data.dom_id);
                }
                state().selected_notes.insert(SelectedNoteData {
                    line_ix,
                    dom_id: note_dom_id,
                    start_beat,
                });
                select_note(note_dom_id);
            }
            (None, Some(_)) => (),
            (Some(_), Some(_)) => common::error(
                "Both `note_dom_id` and `selection_box_dom_id` exist in `MOUSE_DOWN_DATA`!",
            ),
            (None, None) => (),
        }
    }
}

#[wasm_bindgen]
pub fn handle_mouse_wheel(_ydiff: isize) {}

#[wasm_bindgen]
pub fn handle_key_down(key: &str, control_pressed: bool, shift_pressed: bool) {
    // TODO: Check for focus on the canvas either on the frontend or here

    let (line_diff_vertical, beat_diff_horizontal) = match (control_pressed, shift_pressed) {
        (true, false) | (false, true) => (3, 4.0),
        (true, true) => (5, 16.0),
        (false, false) => (1, 1.0),
    };

    fn get_sorted_notes(sort_reverse: bool) -> Vec<&'static SelectedNoteData> {
        let mut notes: Vec<&SelectedNoteData> = state().selected_notes.iter().collect::<Vec<_>>();

        if sort_reverse {
            notes.sort_unstable_by(|a, b| b.cmp(a));
        } else {
            notes.sort_unstable();
        }

        notes
    }

    let move_notes_vertical = |up: bool| {
        let notes = get_sorted_notes(!up);
        let mut notes_to_play: Vec<f32> = Vec::with_capacity(notes.len());

        let move_note_vertical = |mut note_data: SelectedNoteData| -> SelectedNoteData {
            let cond = tern(
                up,
                note_data.line_ix >= line_diff_vertical,
                note_data.line_ix + line_diff_vertical < LINE_COUNT,
            );
            if !cond {
                return note_data;
            }

            let dst_line_ix = if up {
                note_data.line_ix - line_diff_vertical
            } else {
                note_data.line_ix + line_diff_vertical
            };
            notes_to_play.push(midi_to_frequency(dst_line_ix));

            let move_failed = state().note_lines.move_note_vertical(
                note_data.line_ix,
                dst_line_ix,
                note_data.start_beat,
            );
            if move_failed {
                note_data.line_ix = dst_line_ix;
                set_attr(
                    note_data.dom_id,
                    "y",
                    &(note_data.line_ix * PADDED_LINE_HEIGHT).to_string(),
                );
            }

            note_data
        };

        state().selected_notes = notes.into_iter().cloned().map(move_note_vertical).collect();
        trigger_attack_release_multiple(&notes_to_play, 0.0);
    };

    let move_selected_notes_horizontal = |right: bool| {
        let beats_to_move = beat_diff_horizontal * tern(right, 1.0, -1.0);
        let move_note_horizontal = |mut note_data: SelectedNoteData| -> SelectedNoteData {
            let new_start_beat = state().note_lines.move_note_horizontal(
                note_data.line_ix,
                note_data.start_beat,
                beats_to_move,
            );

            set_attr(
                note_data.dom_id,
                "x",
                &((new_start_beat * BEAT_LENGTH_PX) as usize).to_string(),
            );

            note_data.start_beat = new_start_beat;
            note_data
        };

        state().selected_notes = get_sorted_notes(right)
            .into_iter()
            .cloned()
            .map(move_note_horizontal)
            .collect();
    };

    state().control_pressed = control_pressed;
    state().shift_pressed = shift_pressed;

    match key {
        // Delete all currently selected notes
        "Backspace" | "Delete" => {
            for note_data in state().selected_notes.drain() {
                let removed_note = state()
                    .note_lines
                    .remove(note_data.line_ix, note_data.start_beat);
                debug_assert!(removed_note.is_some());
                delete_element(note_data.dom_id);

                if cfg!(debug_assertions) {
                    common::log(format!("{:?}", state().note_lines.lines[note_data.line_ix]));
                }
            }
        }
        "ArrowUp" | "w" => move_notes_vertical(true),
        "ArrowDown" | "s" => move_notes_vertical(false),
        "ArrowRight" | "d" => move_selected_notes_horizontal(true),
        "ArrowLeft" | "a" => move_selected_notes_horizontal(false),
        _ => (),
    }
}

#[allow(clippy::needless_pass_by_value)]
#[wasm_bindgen]
pub fn handle_key_up(_key: &str, control_pressed: bool, shift_pressed: bool) {
    state().control_pressed = control_pressed;
    state().shift_pressed = shift_pressed;
}

#[wasm_bindgen]
pub fn init() {
    common::set_panic_hook();
    unsafe { init_state() };
    draw_grid();
    draw_measure_lines();
    draw_cursor_gutter();
    state().cursor_dom_id = draw_cursor();
}
