#![feature(box_syntax)]

use std::{collections::BTreeMap, ops::Bound};

use float_ord::FloatOrd;

pub mod exports;

#[derive(Clone, Copy, Debug)]
pub struct Note {
    pub id: u32,
    pub length: f64,
}

#[derive(Clone, Copy, Debug)]
pub enum NoteEntry {
    NoteStart { note: Note },
    NoteEnd { note_id: u32 },
    StartAndEnd { start_note: Note, end_note_id: u32 },
}

#[derive(Clone, Default)]
pub struct NoteContainer {
    pub inner: BTreeMap<FloatOrd<f64>, NoteEntry>,
}

/// Represents an array of `NoteContainer`s, matching the representation of the MIDI editor where
/// each note has its own container.
pub struct NoteLines {
    pub lines: Vec<NoteContainer>,
}

impl NoteContainer {
    pub fn add_note(&mut self, start_point: f64, note: Note) {
        debug_assert!(note.length.is_normal() && note.length > 0.);

        let end_point = start_point + note.length;
        // We check to see if there are any notes intersecting the point we're trying to insert
        let range_iter = self.inner.range((
            Bound::Excluded(FloatOrd(start_point)),
            Bound::Excluded(FloatOrd(end_point)),
        ));

        // It's OK if there's a note ending at the point we start and/or a note starting at the
        // point we end, but we need to keep track of it.
        let mut start_touched_note_end_id: Option<u32> = None;
        let mut end_touched_note: Option<Note> = None;
        for (intersected_point, intersected_note_entry) in range_iter {
            match intersected_note_entry {
                NoteEntry::NoteEnd { note_id } if intersected_point.0 == start_point => {
                    start_touched_note_end_id = Some(*note_id);
                },
                end @ NoteEntry::NoteEnd { .. } => panic!(
                    "Found note end intersecting note we're trying to insert that isn't at the \
                     start point: {:?}",
                    end
                ),
                NoteEntry::NoteStart { note } if intersected_point.0 == end_point => {
                    end_touched_note = Some(*note);
                },
                start @ NoteEntry::NoteStart { .. } => panic!(
                    "Found note start intersecting note we're trying to insert that isn't at the \
                     end point: {:?}",
                    start
                ),
                start_and_end @ NoteEntry::StartAndEnd { .. } => panic!(
                    "Found start and end entry intersecting note we're trying to insert: {:?}",
                    start_and_end
                ),
            }
        }

        self.inner
            .insert(FloatOrd(start_point), match start_touched_note_end_id {
                Some(start_touched_note_end_id) => NoteEntry::StartAndEnd {
                    start_note: note,
                    end_note_id: start_touched_note_end_id,
                },
                None => NoteEntry::NoteStart { note },
            });
        self.inner
            .insert(FloatOrd(end_point), match end_touched_note {
                Some(end_touched_note) => NoteEntry::StartAndEnd {
                    start_note: end_touched_note,
                    end_note_id: note.id,
                },
                None => NoteEntry::NoteEnd { note_id: note.id },
            });
    }

    pub fn remove_note(&mut self, note_start: f64, note_id: u32) {
        debug_assert!(note_start.is_normal() && note_start > 0.);

        let (touches, removed_note_length) = match self.inner.get_mut(&FloatOrd(note_start)) {
            Some(entry) => match entry.clone() {
                NoteEntry::NoteStart { note } => {
                    // Nothing to do here, everything good
                    (false, note.length)
                },
                NoteEntry::NoteEnd { .. } => panic!(
                    "Tried to remove note at {} but found invalid entry at the start point: {:?}",
                    note_start, entry
                ),
                NoteEntry::StartAndEnd {
                    end_note_id,
                    start_note,
                } => {
                    // We update the entry in-place removing the reference to the note that
                    // we're removing
                    assert_eq!(
                        start_note.id, note_id,
                        "Trying to remove note at {} but found invalid entry at the start point: \
                         {:?}",
                        note_start, entry
                    );
                    *entry = NoteEntry::NoteEnd {
                        note_id: end_note_id,
                    };
                    (true, start_note.length)
                },
            },
            None => panic!(
                "Tried to remove note at {} but nothing found at that point",
                note_start
            ),
        };

        // If we don't touch, we remove the entry entirely.  If we do touch, we've already handled
        // updating it
        if !touches {
            let removed = self.inner.remove(&FloatOrd(note_start));
            match removed {
                Some(entry) => match entry {
                    NoteEntry::NoteStart { note } => assert_eq!(
                        note.id, note_id,
                        "Removed note starting at {}, but id didn't match; expected_id={}, \
                         found_id={}",
                        note_start, note_id, note.id
                    ),
                    _ => unreachable!(),
                },
                None => panic!("Tried to remove note at {} but not found", note_start),
            }
        }

        // Two entries (one start, one end) are inserted for each note, so we have to remove the end
        // as well
        self.inner
            .remove(&FloatOrd(note_start + removed_note_length));
    }
}
