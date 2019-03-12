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

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NoteBoxBounds {
    pub start_beat: f32,
    pub end_beat: f32,
}

impl NoteBoxBounds {
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
    pub fn intersects_exclusive(&self, other: &NoteBoxBounds) -> bool {
        other.contains_exclusive(self.start_beat)
            || other.contains_exclusive(self.end_beat)
            || self.contains_exclusive(other.start_beat)
            || self.contains_exclusive(other.end_beat)
            || self.start_beat == other.start_beat
            || self.end_beat == other.end_beat
    }

    pub fn width(&self) -> f32 { self.end_beat - self.start_beat }
}

#[derive(Clone)]
pub struct NoteBox<S> {
    pub bounds: NoteBoxBounds,
    pub data: S,
}

impl<S> NoteBox<S> {
    pub fn contains_beat(&self, beat: f32) -> bool { self.bounds.contains(beat) }

    pub fn intersects_beats(&self, start_beat: f32, end_beat: f32) -> bool {
        self.bounds.intersects(&NoteBoxBounds {
            start_beat,
            end_beat,
        })
    }
}

impl<S> Debug for NoteBox<S> {
    fn fmt(&self, fmt: &mut Formatter) -> Result<(), fmt::Error> {
        write!(
            fmt,
            "|{}, {}|",
            self.bounds.start_beat, self.bounds.end_beat
        )
    }
}

impl Eq for NoteBoxBounds {}

impl<S> PartialEq for NoteBox<S> {
    fn eq(&self, other: &Self) -> bool { self.bounds == other.bounds }
}

impl<S> Eq for NoteBox<S> {}

impl PartialOrd for NoteBoxBounds {
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

impl Ord for NoteBoxBounds {
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

impl<S> PartialOrd for NoteBox<S> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.bounds.cmp(&other.bounds)) }
}

impl<S> Ord for NoteBox<S> {
    fn cmp(&self, other: &Self) -> Ordering { self.bounds.cmp(&other.bounds) }
}

pub struct NoteBoxData {
    pub width: usize,
    pub x: usize,
}
