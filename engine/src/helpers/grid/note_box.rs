use std::{
    cmp::Ordering,
    fmt::{self, Debug, Formatter},
};

use std::f32;

#[derive(Serialize, Deserialize)]
pub struct RawNoteData {
    pub line_ix: u32,
    pub start_beat: f32,
    pub width: f32,
}

#[derive(Clone, Copy, PartialEq)]
pub struct NoteBox {
    pub start_beat: f32,
    pub end_beat: f32,
    pub dom_id: usize,
}

impl Debug for NoteBox {
    fn fmt(&self, fmt: &mut Formatter) -> Result<(), fmt::Error> {
        write!(fmt, "|{}, {}|", self.start_beat, self.end_beat)
    }
}

impl Eq for NoteBox {}

impl PartialOrd for NoteBox {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        if self.start_beat > other.end_beat {
            Some(Ordering::Greater)
        } else if self.end_beat < other.start_beat {
            Some(Ordering::Less)
        } else {
            None
        }
    }
}

impl Ord for NoteBox {
    fn cmp(&self, other: &Self) -> Ordering {
        if self.start_beat > other.end_beat {
            Ordering::Greater
        } else if self.end_beat < other.start_beat {
            Ordering::Less
        } else if self.start_beat > other.start_beat {
            Ordering::Greater
        } else {
            Ordering::Less
        }
    }
}

impl NoteBox {
    pub fn contains(&self, beat: f32) -> bool { self.start_beat <= beat && self.end_beat >= beat }

    /// Same as `NoteBox::contains` except edges exactly touching don't count.
    pub fn contains_exclusive(&self, beat: f32) -> bool {
        self.start_beat < beat && self.end_beat > beat
    }

    pub fn intersects(&self, other: &Self) -> bool {
        other.contains(self.start_beat)
            || other.contains(self.end_beat)
            || self.contains(other.start_beat)
            || self.contains(other.end_beat)
    }

    /// Same as `NoteBox::intersects` except edges exactly touching don't count.
    pub fn intersects_exclusive(&self, other: &Self) -> bool {
        other.contains_exclusive(self.start_beat)
            || other.contains_exclusive(self.end_beat)
            || self.contains_exclusive(other.start_beat)
            || self.contains_exclusive(other.end_beat)
            || self.start_beat == other.start_beat
            || self.end_beat == other.end_beat
    }

    pub fn width(&self) -> f32 { self.end_beat - self.start_beat }
}

pub struct NoteBoxData {
    pub width: usize,
    pub x: usize,
}
