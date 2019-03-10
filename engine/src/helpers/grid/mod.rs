pub mod constants;
pub mod note_box;
pub mod prelude;
pub mod selection_box;
pub mod skip_list;

use self::skip_list::NoteLines;

pub struct Grid {
    pub data: NoteLines,
}

pub struct GridConf {
    pub rows: usize,
    pub row_height: usize,
    pub gutter_height: usize,
}

impl Grid {
    pub fn new(conf: &GridConf) -> Self {
        Grid {
            data: NoteLines::new(constants::NOTE_SKIP_LIST_LEVELS),
        }
    }

    // TODO
    fn init(&mut self) {}
}
