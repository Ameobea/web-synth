//! The MIDI editor is the view that is used to actually create music.  It renders a stack of rows
//! that correspond to individual notes.  It supports operations like dragging notes around,
//! selecting/deleting notes, and playing the current composition.

use super::super::view_context::ViewContext;

pub mod composition_saving_loading;
pub mod constants;
pub mod input_handlers;
pub mod note_utils;
pub mod playback;
pub mod prelude;
pub mod render;
pub mod state;
pub mod util;

pub struct MidiEditor(pub state::State);

impl ViewContext for MidiEditor {
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

    fn cleanup(&mut self) { unimplemented!() }

    fn handle_key_down(&mut self, key: &str, control_pressed: bool, shift_pressed: bool) {
        unimplemented!()
    }

    fn handle_key_up(&mut self, key: &str, control_pressed: bool, shift_pressed: bool) {
        unimplemented!()
    }

    fn handle_mouse_down(&mut self, x: usize, y: usize) { unimplemented!() }

    fn handle_mouse_move(&mut self, x: usize, y: usize) { unimplemented!() }

    fn handle_mouse_up(&mut self, x: usize, y: usize) { unimplemented!() }

    fn handle_mouse_wheel(&mut self, ydiff: isize) { unimplemented!() }

    fn load(&mut self, serialized: &str) { unimplemented!() }

    fn save(&self) -> String { unimplemented!() }
}
