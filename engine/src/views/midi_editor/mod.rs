//! The MIDI editor is the view that is used to actually create music.  It renders a stack of rows
//! that correspond to individual notes.  It supports operations like dragging notes around,
//! selecting/deleting notes, and playing the current composition.

use super::super::{
    helpers::grid::{Grid, GridConf, GridHandler, GridRenderer},
    view_context::ViewContext,
};

pub mod composition_saving_loading;
pub mod constants;
pub mod input_handlers;
pub mod note_utils;
pub mod playback;
pub mod prelude;
pub mod render;
pub mod state;
pub mod util;

pub struct MidiEditorGridHandler(pub state::State);

struct MidiEditorGridRenderer;

impl GridRenderer for MidiEditorGridRenderer {
    fn create_note(&mut self, x: usize, y: usize, width: usize, height: usize) -> usize {
        0
        // render::draw_note(line_ix: usize, start_px: f32, width_px: f32) // TODO
    }

    fn select_note(dom_id: usize) {
        // TODO
    }

    fn deselect_note(dom_id: usize) {
        // TODO
    }
}

impl GridHandler for MidiEditorGridHandler {
    fn init(&mut self) {
        unsafe {
            state::init_state();
        };
        render::draw_grid();
        render::draw_measure_lines();
        render::draw_cursor_gutter();
        state::state().cursor_dom_id = render::draw_cursor();
        composition_saving_loading::try_load_saved_composition();
    }

    fn on_note_select(&mut self, dom_id: usize) {
        // TODO
    }

    fn on_note_double_click(&mut self, dom_id: usize) {
        // TODO
    }
}

pub fn mk_midi_editor(config: &str) -> Box<dyn ViewContext> {
    let conf = GridConf {
        gutter_height: constants::CURSOR_GUTTER_HEIGHT,
        row_height: constants::LINE_HEIGHT,
        row_count: constants::LINE_COUNT,
    };
    let grid: Box<Grid<usize, MidiEditorGridRenderer, MidiEditorGridHandler>> =
        box Grid::new(&conf, MidiEditorGridHandler(state::State::default()));
    grid
}
