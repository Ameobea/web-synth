//! Re-exports many common functions, structs, and other things that are useful in multiple
//! parts of the application and would be tedious to import individually.

pub use wasm_bindgen::prelude::*;

pub use super::{
    composition_saving_loading::{
        self, serialize_and_save_composition, try_load_saved_composition,
    },
    constants::*,
    input_handlers, js,
    note_box::{self, NoteBox, NoteBoxData, RawNoteData},
    note_utils,
    render::{self, deselect_note, draw_note, select_note, set_cursor_pos},
    selection_box::{self, update_selection_box, SelectionRegion},
    skip_list::{self, Bounds, NoteLines, NoteSkipList, NoteSkipListNode},
    state::{self, state, SelectedNoteData, Tool},
    synth::{self, PolySynth},
    util::{self, *},
};
