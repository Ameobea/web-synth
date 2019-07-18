extern crate serde;
#[macro_use]
extern crate serde_derive;

#[derive(Serialize, Deserialize)]
pub struct RawNoteData {
    pub line_ix: usize,
    pub start_beat: f32,
    pub width: f32,
}
