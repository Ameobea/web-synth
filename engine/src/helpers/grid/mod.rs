use std::marker::PhantomData;

use super::super::view_context::ViewContext;

pub mod constants;
pub mod note_box;
pub mod prelude;
pub mod selection_box;
pub mod skip_list;

use self::skip_list::NoteLines;

type DomId = usize;

pub trait GridRenderer {
    fn create_note(&mut self, x: usize, y: usize, width: usize, height: usize) -> DomId;
    fn select_note(dom_id: DomId);
    fn deselect_note(dom_id: DomId);
}

pub trait GridHandler {
    fn init(&mut self);

    fn on_note_select(&mut self, dom_id: DomId);
    fn on_note_double_click(&mut self, dom_id: DomId);
}

/// `Grid` is a view context that consists of a set of horizontal rows in which segments, currently
/// called **Notes**, are rendered.  It handles the minutiae of rendering the grid, selecting/
/// deselecting notes, drawing/deleting notes, and passing events down to an attached
/// `GridHandler`.
///
/// The `GridHandler` has the job of implementing custom grid logic.  For the MIDI editor, this
/// includes things like playing the synth when notes are drawn, allowing note movement between
/// different levels, etc.  For the `ClipCompositor`, this includes switching the view to the
/// MIDI editor for a specific track when it's double clicked.
///
/// Finally, it has a `GridRenderer` which is just a bunch of type-level functions that are used
/// to render custom versions of the individual elements of the grid.
pub struct Grid<S, R: GridRenderer, H: GridHandler> {
    pub data: NoteLines<S>,
    pub handler: H,
    renderer: PhantomData<R>,
}

pub struct GridConf {
    pub row_count: usize,
    pub row_height: usize,
    pub gutter_height: usize,
}

impl<S, R: GridRenderer, H: GridHandler> Grid<S, R, H> {
    pub fn new(conf: &GridConf, handler: H) -> Self {
        Grid {
            data: NoteLines::new(constants::NOTE_SKIP_LIST_LEVELS),
            handler,
            renderer: PhantomData,
        }
    }

    // TODO
    fn init(&mut self) {}
}

impl<S, R: GridRenderer, H: GridHandler> ViewContext for Grid<S, R, H> {
    fn init(&mut self) { self.handler.init(); }

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
