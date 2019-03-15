use std::{
    cmp::Ordering,
    fmt::{self, Debug, Formatter},
    hash::{Hash, Hasher},
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

#[derive(Clone, Copy, Debug)]
pub struct SelectedNoteData {
    pub line_ix: usize,
    pub dom_id: usize,
    pub start_beat: f32,
    pub width: f32,
}

impl PartialEq for SelectedNoteData {
    fn eq(&self, other: &Self) -> bool { self.dom_id == other.dom_id }
}

impl Eq for SelectedNoteData {}

// Since `dom_id` is guarenteed to be unique, we can skip hashing the `line_ix` as an optimization.
impl Hash for SelectedNoteData {
    fn hash<H: Hasher>(&self, state: &mut H) { self.dom_id.hash(state) }
}

impl PartialOrd for SelectedNoteData {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        let ix_ordering = self.line_ix.cmp(&other.line_ix);
        let ordering = match ix_ordering {
            Ordering::Equal => self.start_beat.partial_cmp(&other.start_beat).unwrap(),
            _ => ix_ordering,
        };
        Some(ordering)
    }
}

impl Ord for SelectedNoteData {
    fn cmp(&self, other: &Self) -> Ordering { self.partial_cmp(&other).unwrap() }
}

impl SelectedNoteData {
    pub fn from_note_box(line_ix: usize, note_box: &NoteBox<usize>) -> Self {
        SelectedNoteData {
            line_ix,
            dom_id: note_box.data,
            start_beat: note_box.bounds.start_beat,
            width: note_box.bounds.width(),
        }
    }
}

#[derive(Debug)]
pub struct NoteData<'a, S> {
    pub line_ix: usize,
    pub note_box: &'a NoteBox<S>,
}

impl<'a, S> NoteData<'a, S> {
    pub fn get_selection_region(&self) -> SelectionRegion {
        SelectionRegion {
            x: (self.note_box.bounds.start_beat * BEAT_LENGTH_PX) as usize,
            y: self.line_ix * PADDED_LINE_HEIGHT,
            width: ((self.note_box.bounds.end_beat - self.note_box.bounds.start_beat)
                * BEAT_LENGTH_PX) as usize,
            height: LINE_HEIGHT,
        }
    }

    pub fn intersects_region(&self, region: &SelectionRegion) -> bool {
        let our_region = self.get_selection_region();
        // regions intersect if any point bounding our origin is contained in the other region
        our_region.iter_points().any(|pt| region.contains_point(pt))
    }
}
