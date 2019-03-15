//! The MIDI editor is the view that is used to actually create music.  It renders a stack of rows
//! that correspond to individual notes.  It supports operations like dragging notes around,
//! selecting/deleting notes, and playing the current composition.

use super::super::{
    helpers::grid::{Grid, GridConf, GridHandler, GridRenderer},
    prelude::*,
    view_context::ViewContext,
};

pub mod constants;
pub mod input_handlers;
pub mod prelude;
pub mod render;
pub mod state;

struct MidiEditorState {}

pub struct MidiEditorGridHandler(pub MidiEditorState);

struct MidiEditorGridRenderer;

impl GridRenderer for MidiEditorGridRenderer {
    fn create_note(&mut self, x: usize, y: usize, width: usize, height: usize) -> usize {
        js::render_quad(FG_CANVAS_IX, x, y, width, height, "note")
    }

    fn select_note(&mut self, dom_id: usize) { js::add_class(dom_id, "selected"); }

    fn deselect_note(&mut self, dom_id: usize) { js::remove_class(dom_id, "selected"); }

    fn create_cursor(&mut self, conf: &GridConf, cursor_pos_beats: usize) -> usize {
        js::render_line(
            FG_CANVAS_IX,
            cursor_pos_beats,
            0,
            cursor_pos_beats,
            conf.grid_height,
            "cursor",
        )
    }

    fn set_cursor_pos(&mut self, x: usize) {}
}

impl GridHandler for MidiEditorGridHandler {
    fn init(&mut self) {
        unsafe {
            state::init_state();
        };
    }

    fn on_note_select(&mut self, dom_id: usize) {}

    fn on_note_double_click(&mut self, dom_id: usize) {}
}

pub fn mk_midi_editor(config: &str) -> Box<dyn ViewContext> {
    let conf = GridConf {
        gutter_height: constants::CURSOR_GUTTER_HEIGHT,
        row_height: constants::LINE_HEIGHT,
        row_count: constants::LINE_COUNT,
        beat_length_px: 20,
        cursor_gutter_height: constants::CURSOR_GUTTER_HEIGHT,
    };

    let view_context = MidiEditorGridHandler(MidiEditorState {});
    let grid: Box<Grid<usize, MidiEditorGridRenderer, MidiEditorGridHandler>> =
        box Grid::new(conf, view_context);

    grid
}
