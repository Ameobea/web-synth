use wasm_bindgen::prelude::*;

use crate::*;

#[wasm_bindgen]
pub fn create_note_lines(line_count: usize) -> *mut NoteLines {
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
