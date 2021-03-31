use wasm_bindgen::prelude::*;

use crate::{
    note_container::{Note, NoteContainer},
    note_lines::NoteLines,
};

#[wasm_bindgen]
pub fn create_note_lines(line_count: usize) -> *mut NoteLines {
    common::maybe_init();
    Box::into_raw(box NoteLines {
        lines: vec![NoteContainer::default(); line_count],
    })
}

#[wasm_bindgen]
pub fn free_note_lines(lines: *mut NoteLines) { unsafe { drop(Box::from_raw(lines)) } }

static mut NOTE_ID_COUNT: u32 = 0;

pub fn get_new_note_id() -> u32 {
    unsafe {
        NOTE_ID_COUNT += 1;
        NOTE_ID_COUNT
    }
}

#[wasm_bindgen]
pub fn create_note(lines: *mut NoteLines, line_ix: usize, start_point: f64, length: f64) -> u32 {
    let notes = unsafe { &mut *lines };
    let container = &mut notes.lines[line_ix];
    let note_id = get_new_note_id();
    container.add_note(start_point, Note {
        id: note_id,
        length,
    });
    note_id
}

#[wasm_bindgen]
pub fn delete_note(lines: *mut NoteLines, line_ix: usize, start_point: f64, note_id: u32) {
    let notes = unsafe { &mut *lines };
    let container = &mut notes.lines[line_ix];
    container.remove_note(start_point, note_id);
}

#[wasm_bindgen]
pub fn move_note_horizontal(
    lines: *mut NoteLines,
    line_ix: usize,
    start_point: f64,
    note_id: u32,
    desired_new_start_point: f64,
) -> f64 {
    let notes = unsafe { &mut *lines };
    let container = &mut notes.lines[line_ix];
    container.move_note_horizontal(start_point, note_id, desired_new_start_point)
}

#[wasm_bindgen]
pub fn resize_note_horizontal_start(
    lines: *mut NoteLines,
    line_ix: usize,
    start_point: f64,
    note_id: u32,
    new_start_point: f64,
) -> f64 {
    let notes = unsafe { &mut *lines };
    let container = &mut notes.lines[line_ix];
    container.resize_note_start(start_point, note_id, new_start_point)
}

#[wasm_bindgen]
pub fn resize_note_horizontal_end(
    lines: *mut NoteLines,
    line_ix: usize,
    start_point: f64,
    note_id: u32,
    new_end_point: f64,
) -> f64 {
    let notes = unsafe { &mut *lines };
    let container = &mut notes.lines[line_ix];
    container.resize_note_end(start_point, note_id, new_end_point)
}
