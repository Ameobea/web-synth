//! Exports functions to JS that handle events including keyup/keydown, mouse clicks, and
//! scroll

use std::f32;

use wasm_bindgen::prelude::*;

use super::prelude::*;

#[wasm_bindgen]
pub fn handle_key_down(key: &str, control_pressed: bool, shift_pressed: bool) {
    // TODO: Check for focus on the canvas either on the frontend or here

    let (line_diff_vertical, beat_diff_horizontal) = match (control_pressed, shift_pressed) {
        (true, false) | (false, true) => (3, 4.0),
        (true, true) => (5, 16.0),
        (false, false) => (1, 1.0),
    };

    let move_notes_vertical = |up: bool| {
        let notes = state::get_sorted_selected_notes(!up);
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
            if !move_failed {
                note_data.line_ix = dst_line_ix;
                js::set_attr(
                    note_data.dom_id,
                    "y",
                    &(note_data.line_ix * PADDED_LINE_HEIGHT + CURSOR_GUTTER_HEIGHT).to_string(),
                );
            }

            note_data
        };

        state().selected_notes = notes.into_iter().cloned().map(move_note_vertical).collect();
        state().synth.trigger_attacks(&notes_to_play);
        state().synth.trigger_releases(&notes_to_play);
    };

    let move_selected_notes_horizontal = |right: bool| {
        let beats_to_move = beat_diff_horizontal * tern(right, 1.0, -1.0);
        let move_note_horizontal = |mut note_data: SelectedNoteData| -> SelectedNoteData {
            let new_start_beat = state().note_lines.move_note_horizontal(
                note_data.line_ix,
                note_data.start_beat,
                beats_to_move,
            );

            js::set_attr(
                note_data.dom_id,
                "x",
                &((new_start_beat * BEAT_LENGTH_PX) as usize).to_string(),
            );

            note_data.start_beat = new_start_beat;
            note_data
        };

        state().selected_notes = state::get_sorted_selected_notes(right)
            .into_iter()
            .cloned()
            .map(move_note_horizontal)
            .collect();
    };

    state().control_pressed = control_pressed;
    state().shift_pressed = shift_pressed;

    match key {
        // Delete all currently selected notes
        "Backspace" | "Delete" =>
            for note_data in state().selected_notes.drain() {
                let removed_note = state()
                    .note_lines
                    .remove(note_data.line_ix, note_data.start_beat);
                debug_assert!(removed_note.is_some());
                js::delete_element(note_data.dom_id);

                if cfg!(debug_assertions) {
                    common::log(format!("{:?}", state().note_lines.lines[note_data.line_ix]));
                }
            },
        "ArrowUp" | "w" => move_notes_vertical(true),
        "ArrowDown" | "s" => move_notes_vertical(false),
        "ArrowRight" | "d" => move_selected_notes_horizontal(true),
        "ArrowLeft" | "a" => move_selected_notes_horizontal(false),
        "p" => note_utils::copy_selected_notes(),
        "z" | "x" => note_utils::play_selected_notes(),
        " " => {
            playback::start_playback();
            serialize_and_save_composition();
        },
        _ => (),
    }
}

#[allow(clippy::needless_pass_by_value)]
#[wasm_bindgen]
pub fn handle_key_up(key: &str, control_pressed: bool, shift_pressed: bool) {
    state().control_pressed = control_pressed;
    state().shift_pressed = shift_pressed;

    match key {
        "z" | "x" => note_utils::release_selected_notes(),
        " " => synth::stop_playback(),
        _ => (),
    }
}

#[wasm_bindgen]
pub fn handle_mouse_down(mut x: usize, y: usize) {
    let mut drawing_dom_id = None;
    let mut selection_box_dom_id = None;
    let mut dragging_note_data = None;

    // Determine if the requested location intersects an existing note and if not, determine the
    // bounds on the note that will be drawn next.
    let line_ix = match get_line_index(y) {
        Some(line_ix) => line_ix,
        None => {
            // click must be in the cursor gutter
            if state().shift_pressed {
                // TODO: make dedicated function in `render` probably
                state().selection_box_dom_id = Some(js::render_quad(
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

            let x = render::set_cursor_pos(px_to_beat(x as f32)) as usize;
            state().cursor_moving = true;
            state().mouse_down = true;
            state().mouse_down_x = x;
            state().mouse_down_y = GRID_HEIGHT - 2;

            return;
        },
    };
    let beat = px_to_beat(x as f32);
    let bounds = state().note_lines.get_bounds(line_ix, beat);

    if state().cur_tool == Tool::DrawNote && !state().shift_pressed {
        state().synth.trigger_attack(midi_to_frequency(line_ix));
    }

    let mut init_selection_box = || {
        deselect_all_notes();

        // TODO: make dedicated function in `render` probably
        selection_box_dom_id = Some(js::render_quad(
            FG_CANVAS_IX,
            x as f32,
            y as f32,
            0.0,
            0.0,
            "selection-box",
        ));
    };

    match bounds {
        skip_list::Bounds::Intersecting(note) => match state().cur_tool {
            Tool::DeleteNote => {
                let dom_id = note.data;
                render::deselect_note(dom_id);
                js::delete_element(dom_id);
                state().note_lines.remove(line_ix, note.bounds.start_beat);
            },
            Tool::DrawNote if state().shift_pressed => init_selection_box(),
            Tool::DrawNote if state().control_pressed => {
                let selected_data = SelectedNoteData::from_note_box(line_ix, note);

                if state().selected_notes.contains(&selected_data) {
                    state().selected_notes.remove(&selected_data);
                    render::deselect_note(note.data);
                } else {
                    // Select the clicked note since it wasn't previously selected
                    state().selected_notes.insert(selected_data);
                    render::select_note(note.data);
                }
            },
            Tool::DrawNote => {
                let note_data = SelectedNoteData::from_note_box(line_ix, note);
                dragging_note_data = Some((note.bounds.start_beat, note_data));
                deselect_all_notes();
                state().selected_notes.insert(note_data);
                render::select_note(note.data);
            },
        },
        skip_list::Bounds::Bounded(lower, upper) => match state().cur_tool {
            Tool::DrawNote if state().control_pressed => {}, // TODO
            Tool::DrawNote if state().shift_pressed => init_selection_box(),
            Tool::DrawNote => {
                let snapped_lower = snap_to_beat_interval(x, beats_to_px(lower));
                let snapped_upper = (snapped_lower + beats_to_px(NOTE_SNAP_BEAT_INTERVAL))
                    .min(beats_to_px(upper.unwrap_or(f32::INFINITY)));
                let width = snapped_upper - snapped_lower;
                state().cur_note_bounds = (lower, upper);

                // Draw the temporary/candidate note after storing its bounds
                drawing_dom_id = Some(render::draw_note(line_ix, snapped_lower, width));
                x = snapped_lower as usize;
            },
            _ => (),
        },
    };

    state().mouse_down = true;
    state().cursor_moving = false;
    state().mouse_down_x = x;
    state().mouse_down_y = y;
    state().drawing_note_dom_id = drawing_dom_id;
    state().selection_box_dom_id = selection_box_dom_id;
    state().dragging_note_data = dragging_note_data;
}

pub fn compute_note_box_data(x: usize) -> NoteBoxData {
    let start_x = state().mouse_down_x; // TODO
    let (low_bound, high_bound) = state().cur_note_bounds;
    let snap_interval_px = beats_to_px(NOTE_SNAP_BEAT_INTERVAL);
    let snap_to_px = snap_to_beat_interval(x, beats_to_px(low_bound));
    let (minx, maxx) = if x >= start_x {
        let end = (snap_to_px + snap_interval_px)
            .min(beats_to_px(high_bound.unwrap_or(f32::INFINITY))) as usize;
        (start_x, end)
    } else {
        let end = snap_to_px as usize;
        (end, start_x)
    };
    let width = maxx - minx;

    NoteBoxData { x: minx, width }
}

pub fn update_selection_box(
    selection_box_dom_id: usize,
    last_x: usize,
    last_y: usize,
    x: usize,
    y: usize,
) {
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
        state().mouse_down_x,
        state().mouse_down_y,
        x,
        y.saturating_sub(CURSOR_GUTTER_HEIGHT),
        last_x,
        last_y.saturating_sub(CURSOR_GUTTER_HEIGHT),
    );
    js::set_attr(selection_box_dom_id, "x", &x.to_string());
    js::set_attr(
        selection_box_dom_id,
        "y",
        &(y + CURSOR_GUTTER_HEIGHT).to_string(),
    );
    js::set_attr(selection_box_dom_id, "width", &width.to_string());
    js::set_attr(selection_box_dom_id, "height", &height.to_string());

    // Look for all notes in the added/removed regions and add/remove them from the
    // selected notes set and select/deselect their UI representations
    for (was_added, region) in &[
        (changed_region_1.was_added, changed_region_1.region),
        (changed_region_2.was_added, changed_region_2.region),
    ] {
        for note_data in state().note_lines.iter_region(region) {
            // Ignore notes that are also contained in the retained region
            if let Some(retained_region) = retained_region.as_ref() {
                if note_data.intersects_region(&retained_region) {
                    continue;
                }
            }

            let dom_id = note_data.note_box.data;
            let selected_note_data: SelectedNoteData = note_data.into();
            let line_ix = selected_note_data.line_ix;
            if *was_added && state().selected_notes.insert(selected_note_data) {
                render::select_note(dom_id);
                state().synth.trigger_attack(midi_to_frequency(line_ix));
            } else if !*was_added && state().selected_notes.remove(&selected_note_data) {
                render::deselect_note(dom_id);
                state().synth.trigger_release(midi_to_frequency(line_ix));
            }
        }
    }
}

#[wasm_bindgen]
pub fn handle_mouse_move(x: usize, y: usize) {
    let (last_x, last_y) = (state().mouse_x, state().mouse_y);
    state().mouse_x = x;
    state().mouse_y = y;
    if !state().mouse_down {
        return;
    }

    if state().cursor_moving {
        state().mouse_y = 1;
        if let Some(selection_box_dom_id) = state().selection_box_dom_id {
            update_selection_box(selection_box_dom_id, last_x, last_y, x, 1);
        } else {
            render::set_cursor_pos(px_to_beat(x as f32));
        }
        return;
    }

    match state().cur_tool {
        Tool::DrawNote if state().shift_pressed => {
            if let Some(selection_box_dom_id) = state().selection_box_dom_id {
                update_selection_box(selection_box_dom_id, last_x, last_y, x, y);
            }
        },
        Tool::DrawNote => {
            if let Some(dom_id) = state().drawing_note_dom_id {
                let NoteBoxData { x, width } = compute_note_box_data(x);
                js::set_attr(dom_id, "x", &x.to_string());
                js::set_attr(dom_id, "width", &width.to_string());
            } else if let Some((first_dragging_note_start_beat, ref mut dragging_note)) =
                state().dragging_note_data
            {
                // Figure out if we've moved far enough to warrant a move
                let original_line_ix = dragging_note.line_ix;
                let new_line_ix = get_line_index(y).unwrap();

                let horizontal_movement_diff_px = x as f32 - state().mouse_down_x as f32;
                let horizontal_movement_diff_beats = px_to_beat(horizontal_movement_diff_px);
                let horizontal_movement_intervals =
                    (horizontal_movement_diff_beats / NOTE_SNAP_BEAT_INTERVAL).round();
                let original_start_beat = dragging_note.start_beat;
                let new_start_beat = first_dragging_note_start_beat
                    + (horizontal_movement_intervals * NOTE_SNAP_BEAT_INTERVAL);

                if original_line_ix == new_line_ix && original_start_beat == new_start_beat {
                    return;
                }

                // Go with the simple solution: remove from the source line, try to add to the
                // destination line, re-insert in source line if it's blocked.
                common::log(format!(
                    "Removing dragging note starting at {}",
                    dragging_note.start_beat
                ));
                let original_note = state()
                    .note_lines
                    .remove(original_line_ix, dragging_note.start_beat)
                    .unwrap_or_else(|| {
                        panic!(
                            "Tried removing original note starting at {} from the original line \
                             but it wasn't found",
                            dragging_note.start_beat
                        )
                    });
                let note_width = original_note.bounds.width();
                let mut note = original_note.clone();

                let mut try_insert = |line_ix: usize, start_beat: f32| -> bool {
                    note.bounds.start_beat = start_beat;
                    note.bounds.end_beat = start_beat + note_width;
                    let insertion_error = state().note_lines.insert(line_ix, note.clone());
                    if insertion_error.is_none() {
                        dragging_note.start_beat = start_beat;
                        dragging_note.line_ix = line_ix;
                    }
                    insertion_error.is_some()
                };

                let insertion_succeeded = !try_insert(new_line_ix, new_start_beat)
                    || (new_start_beat != original_start_beat
                        && !try_insert(original_line_ix, new_start_beat))
                    || (new_line_ix != original_line_ix
                        && !try_insert(new_line_ix, original_start_beat));
                if !insertion_succeeded {
                    let reinsertion_error =
                        state().note_lines.insert(original_line_ix, original_note);
                    debug_assert!(reinsertion_error.is_none());
                    return;
                }

                state().selected_notes.remove(dragging_note);
                state().selected_notes.insert(*dragging_note);

                if dragging_note.start_beat != original_start_beat {
                    js::set_attr(
                        dragging_note.dom_id,
                        "x",
                        &(beats_to_px(dragging_note.start_beat) as usize).to_string(),
                    );
                }
                if dragging_note.line_ix != original_line_ix {
                    js::set_attr(
                        dragging_note.dom_id,
                        "y",
                        &((dragging_note.line_ix * PADDED_LINE_HEIGHT + CURSOR_GUTTER_HEIGHT)
                            .to_string()),
                    );
                    state()
                        .synth
                        .trigger_release(midi_to_frequency(original_line_ix));
                    state()
                        .synth
                        .trigger_attack(midi_to_frequency(dragging_note.line_ix));
                }
            }
        },
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
        js::delete_element(selection_box_dom_id);

        for note_data in state().selected_notes.iter() {
            state()
                .synth
                .trigger_release(midi_to_frequency(note_data.line_ix));
        }
    };

    if state().cursor_moving {
        if let Some(selection_box_dom_id) = state().selection_box_dom_id {
            delete_selection_box(selection_box_dom_id);
        }

        render::set_cursor_pos(px_to_beat(x as f32));
        return;
    }

    let down_line_ix = get_line_index(state().mouse_down_y).unwrap();

    if let Some(selection_box_dom_id) = state().selection_box_dom_id {
        delete_selection_box(selection_box_dom_id);
    } else if let Some((_, dragging_note_data)) = state().dragging_note_data {
        state()
            .synth
            .trigger_release(midi_to_frequency(dragging_note_data.line_ix));
    } else {
        state()
            .synth
            .trigger_release(midi_to_frequency(down_line_ix));
    }

    if state().cur_tool == Tool::DrawNote {
        match (state().drawing_note_dom_id, state().selection_box_dom_id) {
            (Some(note_dom_id), None) => {
                let NoteBoxData { x, width } = compute_note_box_data(x);
                if width == 0 {
                    return;
                }

                let x_px = x as f32;
                let start_beat = px_to_beat(x_px);
                let line_ix = down_line_ix;
                let note = NoteBox {
                    data: note_dom_id,
                    bounds: NoteBoxBounds {
                        start_beat,
                        end_beat: px_to_beat(x_px + width as f32),
                    },
                };

                deselect_all_notes();
                state().selected_notes.insert(SelectedNoteData {
                    line_ix,
                    dom_id: note_dom_id,
                    start_beat,
                    width: note.bounds.width(),
                });
                render::select_note(note_dom_id);

                // Actually insert the node into the skip list
                state().note_lines.insert(line_ix, note);
                if cfg!(debug_assertions) {
                    common::log(format!("{:?}", state().note_lines.lines[line_ix]));
                }
            },
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
