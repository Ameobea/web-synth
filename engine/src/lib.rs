#![feature(box_syntax, test, slice_patterns, nll, thread_local)]

extern crate common;
extern crate fnv;
extern crate rand;
extern crate rand_pcg;
extern crate slab;
extern crate test;
extern crate wasm_bindgen;

use std::f32;

use fnv::FnvHashSet;
use wasm_bindgen::prelude::*;

pub mod render;
pub mod selection_box;
pub mod skip_list;
pub mod state;
pub mod util;
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
    let note_lines = lines();
    let selected_notes = unsafe { &mut *SELECTED_NOTES };
    let cur_tool = unsafe { CUR_TOOL };
    let ctrl_pressed = unsafe { CONTROL_PRESSED };
    let shift_pressed = unsafe { SHIFT_PRESSED };

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
            if shift_pressed {
                unsafe {
                    MOUSE_DOWN_DATA.selection_box_dom_id = Some(render_quad(
                        FG_CANVAS_IX,
                        0.0,
                        y as f32,
                        0.0,
                        GRID_HEIGHT as f32,
                        "selection-box",
                    ))
                };
            } else {
                unsafe { MOUSE_DOWN_DATA.selection_box_dom_id = None };
            }

            let x = set_cursor_pos(x) as usize;
            unsafe {
                MOUSE_DOWN_DATA.cursor_movement = true;
                MOUSE_DOWN_DATA.down = true;
                MOUSE_DOWN_DATA.x = x;
                MOUSE_DOWN_DATA.y = GRID_HEIGHT - 2;
            };

            return;
        }
    };
    let beat = px_to_beat(x as f32);
    let bounds = note_lines.get_bounds(line_ix, beat);

    if cur_tool == Tool::DrawNote && !shift_pressed {
        trigger_attack(midi_to_frequency(line_ix));
    }

    let mut init_selection_box = || {
        for note_data in selected_notes.drain() {
            deselect_note(note_data.dom_id);
        }
        draw_selection_box();
    };

    match bounds {
        Bounds::Intersecting(node) => match cur_tool {
            Tool::DrawNote if shift_pressed => init_selection_box(),
            Tool::DeleteNote => {
                let &NoteBox {
                    start_beat, dom_id, ..
                } = &*node.val_slot_key;
                unimplemented!(); // TODO
                lines().remove(line_ix, start_beat);
            }
            Tool::DrawNote => {
                let NoteBox { dom_id, .. } = *node.val_slot_key;
                let selected_data = SelectedNoteData {
                    line_ix,
                    dom_id,
                    start_beat: node.val_slot_key.start_beat,
                };

                let select_new = if ctrl_pressed {
                    if selected_notes.contains(&selected_data) {
                        deselect_note(dom_id);
                        selected_notes.remove(&selected_data);
                        false
                    } else {
                        true
                    }
                } else {
                    let mut select_new: bool = true;
                    // Deselect all selected notes
                    for note_data in selected_notes.drain() {
                        deselect_note(note_data.dom_id);
                        if note_data.dom_id == dom_id {
                            select_new = false;
                        }
                    }

                    select_new
                };

                if select_new {
                    // Select the clicked note since it wasn't previously selected
                    selected_notes.insert(selected_data);
                    select_note(dom_id);
                }
            }
        },
        Bounds::Bounded(lower, upper) => match cur_tool {
            Tool::DrawNote if ctrl_pressed => {} // TODO
            Tool::DrawNote if shift_pressed => init_selection_box(),
            Tool::DrawNote => {
                let snapped_lower = snap_to_beat_interval(x, beats_to_px(lower));
                let snapped_upper = (snapped_lower + beats_to_px(NOTE_SNAP_BEAT_INTERVAL))
                    .min(beats_to_px(upper.unwrap_or(f32::INFINITY)));
                let width = snapped_upper - snapped_lower;
                unsafe { CUR_NOTE_BOUNDS = (lower, upper) };

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

    unsafe {
        MOUSE_DOWN_DATA = MouseDownData {
            down: true,
            cursor_movement: false,
            x,
            y,
            note_dom_id: drawing_dom_id,
            selection_box_dom_id,
        };
    }
}

#[wasm_bindgen]
pub fn handle_mouse_move(x: usize, y: usize) {
    let (last_x, last_y) = unsafe { CUR_MOUSE_COORDS };
    unsafe { CUR_MOUSE_COORDS = (x, y) };
    if !mouse_down() {
        return;
    }
    let shift_pressed = unsafe { SHIFT_PRESSED };
    let &mut MouseDownData {
        cursor_movement,
        note_dom_id,
        selection_box_dom_id,
        ..
    } = unsafe { &mut MOUSE_DOWN_DATA };
    let cur_tool = unsafe { CUR_TOOL };
    let selected_notes = unsafe { &mut *SELECTED_NOTES };

    let mut update_selection_box = |selection_box_dom_id: usize, x: usize, y: usize| {
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
            for note_data in lines().iter_region(region) {
                // Ignore notes that are also contained in the retained region
                if let Some(retained_region) = retained_region.as_ref() {
                    if note_data.intersects_region(&retained_region) {
                        continue;
                    }
                }

                let dom_id = note_data.note_box.dom_id;
                let selected_note_data: SelectedNoteData = note_data.into();
                let line_ix = selected_note_data.line_ix;
                if *was_added && selected_notes.insert(selected_note_data) {
                    select_note(dom_id);
                    trigger_attack(midi_to_frequency(line_ix));
                } else if !*was_added && selected_notes.remove(&selected_note_data) {
                    deselect_note(dom_id);
                    trigger_release(midi_to_frequency(line_ix));
                }
            }
        }
    };

    if cursor_movement {
        unsafe { CUR_MOUSE_COORDS.1 = 1 };
        if let Some(selection_box_dom_id) = selection_box_dom_id {
            update_selection_box(selection_box_dom_id, x, 1);
        } else {
            set_cursor_pos(x);
        }
        return;
    }

    match cur_tool {
        Tool::DrawNote if shift_pressed => {
            if let Some(selection_box_dom_id) = selection_box_dom_id {
                update_selection_box(selection_box_dom_id, x, y);
            }
        }
        Tool::DrawNote => {
            if let Some(dom_id) = note_dom_id {
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
    if !mouse_down() {
        return;
    }
    let &mut MouseDownData {
        ref mut down,
        y,
        cursor_movement,
        note_dom_id,
        selection_box_dom_id,
        ..
    } = unsafe { &mut MOUSE_DOWN_DATA };
    *down = false;

    let delete_selection_box = |selection_box_dom_id: usize| {
        delete_element(selection_box_dom_id);

        for note_data in unsafe { &*SELECTED_NOTES }.iter() {
            trigger_release(midi_to_frequency(note_data.line_ix));
        }
    };

    if cursor_movement {
        if let Some(selection_box_dom_id) = selection_box_dom_id {
            delete_selection_box(selection_box_dom_id);
        }

        set_cursor_pos(x);
        return;
    }

    let down_line_ix = get_line_index(y).unwrap();

    if let Some(selection_box_dom_id) = selection_box_dom_id {
        delete_selection_box(selection_box_dom_id);
    } else {
        trigger_release(midi_to_frequency(down_line_ix));
    }

    if unsafe { CUR_TOOL } == Tool::DrawNote {
        match (note_dom_id, selection_box_dom_id) {
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
                lines().insert(line_ix, note);
                if cfg!(debug_assertions) {
                    common::log(format!("{:?}", lines().lines[line_ix]));
                }

                let selected_notes = unsafe { &mut *SELECTED_NOTES };
                for note_data in selected_notes.drain() {
                    deselect_note(note_data.dom_id);
                }
                selected_notes.insert(SelectedNoteData {
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
    let selected_notes = unsafe { &mut *SELECTED_NOTES };

    let (line_diff_vertical, beat_diff_horizontal) = match (control_pressed, shift_pressed) {
        (true, false) | (false, true) => (3, 4.0),
        (true, true) => (5, 16.0),
        (false, false) => (1, 1.0),
    };

    fn map_selected_notes<
        F: FnMut(SelectedNoteData) -> SelectedNoteData,
        I: Iterator<Item = SelectedNoteData>,
    >(
        notes_iter: I,
        f: F,
    ) {
        let new_selected_notes: FnvHashSet<_> = notes_iter.map(f).collect();
        unsafe { *SELECTED_NOTES = new_selected_notes };
    };

    fn get_sorted_notes(sort_reverse: bool) -> Vec<&'static SelectedNoteData> {
        let mut notes: Vec<&SelectedNoteData> =
            unsafe { &mut *SELECTED_NOTES }.iter().collect::<Vec<_>>();

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
            if !tern(
                up,
                note_data.line_ix >= line_diff_vertical,
                note_data.line_ix + line_diff_vertical < LINE_COUNT,
            ) {
                return note_data;
            }

            let dst_line_ix = if up {
                note_data.line_ix - line_diff_vertical
            } else {
                note_data.line_ix + line_diff_vertical
            };
            notes_to_play.push(midi_to_frequency(dst_line_ix));

            if !lines().move_note_vertical(note_data.line_ix, dst_line_ix, note_data.start_beat) {
                note_data.line_ix = dst_line_ix;
                set_attr(
                    note_data.dom_id,
                    "y",
                    &(note_data.line_ix * PADDED_LINE_HEIGHT).to_string(),
                );
            }

            note_data
        };

        map_selected_notes(notes.into_iter().cloned(), move_note_vertical);
        trigger_attack_release_multiple(&notes_to_play, 0.0);
    };

    let mut move_selected_notes_horizontal = |right: bool| {
        let beats_to_move = beat_diff_horizontal * tern(right, 1.0, -1.0);
        let move_note_horizontal = |mut note_data: SelectedNoteData| -> SelectedNoteData {
            let new_start_beat = lines().move_note_horizontal(
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

        let notes = get_sorted_notes(right);
        map_selected_notes(notes.into_iter().cloned(), move_note_horizontal);
    };

    unsafe { CONTROL_PRESSED = control_pressed };
    unsafe { SHIFT_PRESSED = shift_pressed };

    match key {
        // Delete all currently selected notes
        "Backspace" | "Delete" => {
            for note_data in selected_notes.drain() {
                let removed_note = lines().remove(note_data.line_ix, note_data.start_beat);
                debug_assert!(removed_note.is_some());
                delete_element(note_data.dom_id);

                if cfg!(debug_assertions) {
                    common::log(format!("{:?}", lines().lines[note_data.line_ix]));
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
    unsafe { CONTROL_PRESSED = control_pressed };
    unsafe { SHIFT_PRESSED = shift_pressed };
}

#[wasm_bindgen]
pub fn init() {
    common::set_panic_hook();
    unsafe { init_state() };
    draw_grid();
    draw_measure_lines();
    draw_cursor_gutter();
    unsafe { CURSOR_DOM_ID = draw_cursor() };
}
