use std::{
  collections::{BTreeMap, HashSet},
  ops::Bound,
};

use float_ord::FloatOrd;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Note {
  pub id: u32,
  pub length: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NoteEntry {
  NoteStart { note: Note },
  NoteEnd { note_id: u32 },
  StartAndEnd { start_note: Note, end_note_id: u32 },
}

impl NoteEntry {
  pub fn get_ids(&self) -> (u32, Option<u32>) {
    match self {
      NoteEntry::NoteStart { note } => (note.id, None),
      NoteEntry::NoteEnd { note_id } => (*note_id, None),
      NoteEntry::StartAndEnd {
        start_note,
        end_note_id,
      } => (start_note.id, Some(*end_note_id)),
    }
  }
}

#[derive(Default)]
pub struct NoteContainer {
  pub inner: BTreeMap<FloatOrd<f64>, NoteEntry>,
}

impl NoteContainer {
  pub fn check_can_add_note(&self, start_point: f64, length: f64) -> bool {
    let end_point = start_point + length;
    let range = self.inner.range((
      Bound::Included(FloatOrd(start_point)),
      Bound::Included(FloatOrd(end_point)),
    ));

    for (intersect_point, intersected_entry) in range {
      // It's OK if we are exactly touching note(s) on either side, but any other entry is a
      // blocker
      match intersected_entry {
        NoteEntry::NoteEnd { .. } if intersect_point.0 == start_point => (),
        NoteEntry::NoteStart { .. } if intersect_point.0 == end_point => (),
        _ => return false,
      }
    }

    // We also need to make sure that we're not completely within a bigger note.  We can
    // determine this by checking if the first entry to the left starts a note.
    let mut range = self
      .inner
      .range((
        Bound::Included(FloatOrd(-100.)),
        Bound::Included(FloatOrd(start_point)),
      ))
      .rev();
    match range.next().map(|(_point, entry)| entry) {
      None => (),
      Some(NoteEntry::NoteEnd { .. }) => (),
      Some(_) => return false,
    }

    return true;
  }

  pub fn add_note(&mut self, start_point: f64, note: Note) {
    assert!(note.length.is_normal() && note.length > 0.);
    assert!(start_point >= 0.);
    println!("Inserting {:?} at {}", note, start_point);

    let end_point = start_point + note.length;
    // We check to see if there are any notes intersecting the point we're trying to insert
    let range_iter = self.inner.range((
      Bound::Included(FloatOrd(start_point)),
      Bound::Included(FloatOrd(end_point)),
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
          "Found note end intersecting note we're trying to insert that isn't at the start point: \
           {:?}",
          end
        ),
        NoteEntry::NoteStart { note } if intersected_point.0 == end_point => {
          end_touched_note = Some(*note);
        },
        start @ NoteEntry::NoteStart { .. } => panic!(
          "Found note start intersecting note we're trying to insert that isn't at the end point: \
           {:?}",
          start
        ),
        start_and_end @ NoteEntry::StartAndEnd { .. } => panic!(
          "Found start and end entry intersecting note we're trying to insert: {:?}",
          start_and_end
        ),
      }
    }

    self
      .inner
      .insert(FloatOrd(start_point), match start_touched_note_end_id {
        Some(start_touched_note_end_id) => NoteEntry::StartAndEnd {
          start_note: note,
          end_note_id: start_touched_note_end_id,
        },
        None => NoteEntry::NoteStart { note },
      });
    self
      .inner
      .insert(FloatOrd(end_point), match end_touched_note {
        Some(end_touched_note) => NoteEntry::StartAndEnd {
          start_note: end_touched_note,
          end_note_id: note.id,
        },
        None => NoteEntry::NoteEnd { note_id: note.id },
      });
  }

  pub fn remove_note(&mut self, note_start: f64, note_id: u32) -> Note {
    assert!(!note_start.is_nan() && note_start >= 0.);
    assert!(note_start >= 0.);

    let (removed_note, removed_note_length) = match self.inner.get_mut(&FloatOrd(note_start)) {
      Some(entry) => match entry.clone() {
        NoteEntry::NoteStart { note } => {
          // Nothing to do here, everything good
          (None, note.length)
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
            "Trying to remove note at {} but found invalid entry at the start point: {:?}",
            note_start, entry
          );
          *entry = NoteEntry::NoteEnd {
            note_id: end_note_id,
          };
          (Some(start_note), start_note.length)
        },
      },
      None => panic!(
        "Tried to remove note at {} but nothing found at that point",
        note_start
      ),
    };

    // If we don't touch, we remove the entry entirely.  If we do touch, we've already handled
    // updating it
    let removed = match removed_note {
      Some(removed) => removed,
      None => {
        let removed = self.inner.remove(&FloatOrd(note_start));
        match removed {
          Some(entry) => match entry {
            NoteEntry::NoteStart { note } => {
              assert_eq!(
                note.id, note_id,
                "Removed note starting at {}, but id didn't match; expected_id={}, found_id={}",
                note_start, note_id, note.id
              );
              note
            },
            _ => unreachable!(),
          },
          None => panic!("Tried to remove note at {} but not found", note_start),
        }
      },
    };

    // Two entries (one start, one end) are inserted for each note, so we have to remove the end
    // as well
    let removed_end = self
      .inner
      .remove(&FloatOrd(note_start + removed_note_length))
      .unwrap_or_else(|| {
        panic!(
          "No note end entry exists at point {}",
          note_start + removed_note_length
        )
      });
    match removed_end {
      NoteEntry::NoteEnd { .. } => (),
      NoteEntry::NoteStart { .. } => unreachable!(),
      // If it's a start and end, we downgrade it into just a start
      NoteEntry::StartAndEnd { start_note, .. } => {
        self.inner.insert(
          FloatOrd(note_start + removed_note_length),
          NoteEntry::NoteStart { note: start_note },
        );
      },
    }
    removed
  }

  /// Attempts to move the note horizontally to the new `start_point`.  It will check to see if
  /// there is anything blocking it in that range and, if there is, will stop moving part of the
  /// way there until it's touching the blocking note.  Returns the actual new start point of the
  /// note, which will be the same as the current starting point if no move is possible.
  pub fn move_note_horizontal(
    &mut self,
    start_point: f64,
    note_id: u32,
    new_start_point: f64,
  ) -> f64 {
    if start_point.is_nan() || new_start_point.is_nan() {
      panic!()
    }
    assert!(start_point >= 0. && new_start_point >= 0.);
    if start_point == new_start_point {
      return new_start_point;
    }

    let note = match self
      .inner
      .get(&FloatOrd(start_point))
      .unwrap_or_else(|| panic!("No note found starting at {}", start_point))
    {
      NoteEntry::NoteStart { note } => note.clone(),
      NoteEntry::StartAndEnd { start_note, .. } => start_note.clone(),
      note_end => panic!("Invalid note entry for start point, found: {:?}", note_end),
    };

    let removed = self.remove_note(start_point, note_id);

    // We first check the happy path and see if the place we're trying to move to is entirely
    // unblocked
    let new_end_point = new_start_point + note.length;
    let is_completely_unblocked = self.check_can_add_note(new_start_point, note.length);

    if is_completely_unblocked {
      self.add_note(new_start_point, removed);
      return new_start_point;
    }

    if new_start_point < start_point {
      // MOVING LEFT

      let range = self.inner.range((
        Bound::Included(FloatOrd(new_start_point)),
        Bound::Included(FloatOrd(start_point)),
      ));

      // Search the range to find the best (closest to target start point) point at which we
      // can validly move this note.
      let mut best_start_point: Option<f64> = None;
      for (point, entry) in range {
        // We want to avoid moving too far and placing our actual new start point before
        // the target new start point, so we filter those situations out.

        match entry {
          NoteEntry::NoteStart { .. } => {
            let possible_new_start_point = point.0 - note.length;
            if possible_new_start_point < new_start_point {
              continue;
            }

            if self.check_can_add_note(possible_new_start_point, note.length) {
              best_start_point = Some(possible_new_start_point);
              break;
            }
          },
          NoteEntry::NoteEnd { .. } =>
            if self.check_can_add_note(point.0, note.length) {
              best_start_point = Some(point.0);
              break;
            },
          _ => continue,
        }
      }

      let real_new_start_point = best_start_point.unwrap_or(start_point);
      self.add_note(real_new_start_point, note);
      real_new_start_point
    } else {
      // MOVING RIGHT

      let end_point = start_point + note.length;
      // Reverse the range since we want to search from closest to the desired new start point
      // to furthest
      let range = self
        .inner
        .range((
          Bound::Included(FloatOrd(end_point)),
          Bound::Included(FloatOrd(new_end_point)),
        ))
        .rev();

      // Search the range to find the best (closest to target start point) point at which we
      // can validly move this note.
      let mut best_start_point: Option<f64> = None;
      for (point, entry) in range {
        // The only entry type that we can possibly insert directly after is note end
        match entry {
          NoteEntry::NoteStart { .. } => {
            let possible_new_start_point = point.0 - note.length;
            if self.check_can_add_note(possible_new_start_point, note.length) {
              best_start_point = Some(possible_new_start_point);
              break;
            }
          },
          NoteEntry::NoteEnd { .. } =>
            if self.check_can_add_note(point.0, note.length) {
              best_start_point = Some(point.0);
              break;
            },
          _ => continue,
        }
      }

      let real_new_start_point = best_start_point.unwrap_or(start_point);
      self.add_note(real_new_start_point, note);
      real_new_start_point
    }
  }

  /// Tries to resize the note by moving its end point.  Returns the new end point that was
  /// actually set after accounting for blocks etc.
  pub fn resize_note_end(&mut self, start_point: f64, note_id: u32, new_end_point: f64) -> f64 {
    assert!(!new_end_point.is_nan());
    assert!(new_end_point > start_point);

    let start_entry = self
      .inner
      .get(&FloatOrd(start_point))
      .unwrap_or_else(|| panic!("No note found with start point={}", start_point))
      .clone();
    let note = match start_entry {
      NoteEntry::NoteStart { note } => note,
      NoteEntry::StartAndEnd { start_note, .. } => start_note,
      NoteEntry::NoteEnd { .. } => panic!(
        "Found note end entry at expected start point={}",
        start_point
      ),
    };
    assert_eq!(
      note.id, note_id,
      "Note starting at point {} had different id than expexted, expected={}, actual={}",
      start_point, note_id, note.id
    );
    let old_end_point = start_point + note.length;
    if new_end_point == old_end_point {
      return old_end_point;
    }

    let removed_entry = self
      .inner
      .remove(&FloatOrd(old_end_point))
      .unwrap_or_else(|| panic!("No entry at expected end point={}", old_end_point));
    // If the removed entry is start and end, we re-insert it as just a start
    match removed_entry {
      NoteEntry::NoteEnd { .. } => (),
      NoteEntry::StartAndEnd { start_note, .. } => {
        self
          .inner
          .insert(FloatOrd(old_end_point), NoteEntry::NoteStart {
            note: start_note,
          });
      },
      _ => unreachable!(),
    }

    let real_new_end_point = if new_end_point < old_end_point {
      // If we're shrinking the note, there is no way it can fail so we just insert the end
      // point directly
      new_end_point
    } else {
      // We have to scan through the notes to find the first entry that blocks us on our way
      // to the desired new end point, if there is one.  If not, we can grow all the way.
      let mut range = self.inner.range((
        Bound::Included(FloatOrd(old_end_point)),
        Bound::Included(FloatOrd(new_end_point)),
      ));
      range
        .next()
        .map(|(point, _entry)| point.0)
        .unwrap_or(new_end_point)
    };

    // See if we need to merge this entry with another
    let existing_entry = self.inner.remove(&FloatOrd(real_new_end_point));
    if let Some(existing_entry) = existing_entry {
      match existing_entry {
        NoteEntry::NoteStart {
          note: touching_note,
        } => {
          self
            .inner
            .insert(FloatOrd(real_new_end_point), NoteEntry::StartAndEnd {
              start_note: touching_note,
              end_note_id: note.id,
            });
        },
        _ => unreachable!(),
      }
    } else {
      self
        .inner
        .insert(FloatOrd(real_new_end_point), NoteEntry::NoteEnd {
          note_id: note.id,
        });
    }

    // Update the note start to keep its length accurate
    let start_entry = self
      .inner
      .get_mut(&FloatOrd(start_point))
      .unwrap_or_else(|| panic!("No note found with start point={}", start_point));
    let note = match start_entry {
      NoteEntry::NoteStart { note } => note,
      NoteEntry::StartAndEnd { start_note, .. } => start_note,
      NoteEntry::NoteEnd { .. } => panic!(
        "Found note end entry at expected start point={}",
        start_point
      ),
    };
    note.length = real_new_end_point - start_point;

    real_new_end_point
  }

  /// Tries to resize the note by moving its start point.  Returns the new start point that was
  /// actually set after account for blocks etc.
  pub fn resize_note_start(&mut self, start_point: f64, note_id: u32, new_start_point: f64) -> f64 {
    assert!(!new_start_point.is_nan());
    if start_point == new_start_point {
      return new_start_point;
    }

    let start_entry = self
      .inner
      .remove(&FloatOrd(start_point))
      .unwrap_or_else(|| panic!("No note found with start point={}", start_point));
    let note = match &start_entry {
      NoteEntry::NoteStart { note } => note.clone(),
      NoteEntry::StartAndEnd {
        start_note,
        end_note_id,
      } => {
        // Re-insert the end note we touch as just an end entry
        self
          .inner
          .insert(FloatOrd(start_point), NoteEntry::NoteEnd {
            note_id: *end_note_id,
          });

        start_note.clone()
      },
      NoteEntry::NoteEnd { .. } => panic!(
        "Found note end entry at expected start point={}",
        start_point
      ),
    };
    assert_eq!(
      note.id, note_id,
      "Note starting at point {} had different id than expexted, expected={}, actual={}",
      start_point, note_id, note.id
    );

    let end_point = start_point + note.length;
    assert!(new_start_point < end_point);

    let real_new_start_point = if new_start_point > start_point {
      // If we're moving the start point up, it's infallible since nothing can block it since
      // we're already taking up that space
      new_start_point
    } else {
      // Scan through the entries looking for the first entry that will block our expansion
      // left.  If nothing blocks us, we are free to resize all the way to the new desired
      // start point.
      let mut range = self.inner.range((
                Bound::Included(FloatOrd(new_start_point)),
                Bound::Included(FloatOrd(start_point)),
            ))
            // We want to look for the first entry to block us, so we scan in reverse
            .rev();

      range
        .next()
        .map(|(point, _entry)| point.0)
        .unwrap_or(new_start_point)
    };

    // Re-insert the start entry after updating the length
    let existing_entry = self.inner.remove(&FloatOrd(real_new_start_point));
    if let Some(existing_entry) = existing_entry {
      let end_note_id = match existing_entry {
        NoteEntry::NoteEnd { note_id } => note_id,
        _ => unreachable!(),
      };
      self
        .inner
        .insert(FloatOrd(real_new_start_point), NoteEntry::StartAndEnd {
          start_note: Note {
            id: note.id,
            length: end_point - real_new_start_point,
          },
          end_note_id,
        });
    } else {
      self
        .inner
        .insert(FloatOrd(real_new_start_point), NoteEntry::NoteStart {
          note: Note {
            id: note.id,
            length: end_point - real_new_start_point,
          },
        });
    }

    real_new_start_point
  }

  pub fn iter_notes(&self, acc: &mut HashSet<u32>, mut start_point: f64, end_point: f64) {
    start_point = start_point.max(0.);
    let iterator = self.inner.range((
      Bound::Included(FloatOrd(start_point)),
      Bound::Included(FloatOrd(end_point)),
    ));

    for (_pos, entry) in iterator {
      let (id1, id2_opt) = entry.get_ids();
      acc.insert(id1);
      if let Some(id2) = id2_opt {
        acc.insert(id2);
      }
    }

    // Lastly, we need to check if we're fully inside of a note
    let mut iterator = self
      .inner
      .range((
        Bound::Included(FloatOrd(-1.)),
        Bound::Excluded(FloatOrd(start_point)),
      ))
      .rev();
    match iterator.next() {
      Some((_point, NoteEntry::NoteStart { note })) => {
        acc.insert(note.id);
      },
      Some((_point, NoteEntry::StartAndEnd { start_note, .. })) => {
        acc.insert(start_note.id);
      },
      _ => (),
    }
  }
}

#[test]
pub fn basic_insertion_removal() {
  let mut container = NoteContainer::default();
  let note = Note { id: 0, length: 1. };
  container.add_note(1., note);
  let removed = container.remove_note(1., note.id);
  assert_eq!(note, removed);
}

#[test]
pub fn add_remove_touching_notes() {
  let mut container = NoteContainer::default();
  let note1 = Note { id: 0, length: 1. };
  let note2 = Note { id: 1, length: 1. };
  container.add_note(0., note1);
  container.add_note(1., note2);
  let removed1 = container.remove_note(0., note1.id);
  assert_eq!(removed1, note1);
  let removed2 = container.remove_note(1., note2.id);
  assert_eq!(removed2, note2);
}

#[test]
pub fn simple_nonblocking_horizontal_move() {
  let mut container = NoteContainer::default();
  let note = Note { id: 0, length: 1. };
  container.add_note(1., note);
  container.move_note_horizontal(1., note.id, 5.);
  let removed = container.remove_note(5., note.id);
  assert_eq!(note, removed);
}

#[test]
pub fn move_note_self_intersecting_left() {
  let mut container = NoteContainer::default();
  let note = Note { id: 0, length: 1. };
  container.add_note(1., note);
  container.move_note_horizontal(1., note.id, 0.8);
  let removed = container.remove_note(0.8, note.id);
  assert_eq!(note, removed);
}

#[test]
pub fn move_note_self_intersecting_right() {
  let mut container = NoteContainer::default();
  let note = Note { id: 0, length: 1. };
  container.add_note(1., note);
  container.move_note_horizontal(1., note.id, 1.2);
  let removed = container.remove_note(1.2, note.id);
  assert_eq!(note, removed);
}

#[test]
#[should_panic]
pub fn insert_overlapping_bad() {
  let mut container = NoteContainer::default();
  let note1 = Note { id: 0, length: 1. };
  let note2 = Note { id: 1, length: 1. };
  container.add_note(1., note1);
  container.add_note(1.2, note2);
}

#[test]
#[should_panic]
pub fn insert_nan_bad() {
  let mut container = NoteContainer::default();
  container.add_note(std::f64::NAN, Note { id: 0, length: 2. });
}

#[test]
#[should_panic]
pub fn insert_zero_length_note_bad() {
  let mut container = NoteContainer::default();
  container.add_note(0., Note { id: 0, length: 0. });
}

#[test]
pub fn move_horizontal_left_blocked() {
  let mut container = NoteContainer::default();
  let note1 = Note { id: 0, length: 1. };
  let note2 = Note { id: 1, length: 1. };
  container.add_note(1., note1);
  container.add_note(5., note2);
  let new_note2_start_point = container.move_note_horizontal(5., note2.id, 1.);
  // note2 should get blocked at the end point of note1
  assert_eq!(2., new_note2_start_point);
}

#[test]
pub fn move_horizontal_right_blocked() {
  let mut container = NoteContainer::default();
  let note1 = Note { id: 0, length: 1. };
  let note2 = Note { id: 1, length: 1. };
  container.add_note(5., note1);
  container.add_note(1., note2);
  let new_note2_start_point = container.move_note_horizontal(1., note2.id, 4.5);
  // note2 should get blocked at the start point of note1
  assert_eq!(4., new_note2_start_point);
}

#[test]
pub fn move_horizontal_snug_fit() {
  let mut container = NoteContainer::default();
  let note_left = Note { id: 0, length: 1. };
  let note_right = Note { id: 1, length: 2. };
  let moving_note = Note { id: 2, length: 1. };
  container.add_note(2., note_left);
  container.add_note(4., note_right);
  container.add_note(0., moving_note);
  let new_moving_note_start_point = container.move_note_horizontal(0., moving_note.id, 3.5);
  assert_eq!(new_moving_note_start_point, 3.);
}

#[test]
pub fn resize_note_infallable() {
  let mut container = NoteContainer::default();
  let note = Note { id: 0, length: 2. };
  container.add_note(1., note);
  let new_end_point = container.resize_note_end(1., note.id, 2.);
  assert_eq!(new_end_point, 2.);

  let new_start_point = container.resize_note_start(1., note.id, 1.5);
  assert_eq!(new_start_point, 1.5);

  let entry = container.inner.remove(&FloatOrd(1.5)).unwrap();
  assert_eq!(
    NoteEntry::NoteStart {
      note: Note { id: 0, length: 0.5 }
    },
    entry
  );
}

#[test]
pub fn resize_note_start_blocked() {
  let mut container = NoteContainer::default();
  let blocking_note = Note { id: 0, length: 1. };
  let resizing_note = Note { id: 1, length: 1. };
  container.add_note(1., blocking_note);
  container.add_note(4., resizing_note);
  let new_start_point = container.resize_note_start(4., resizing_note.id, 0.5);
  assert_eq!(new_start_point, 2.);
}

#[test]
pub fn resize_note_end_blocked() {
  let mut container = NoteContainer::default();
  let blocking_note = Note { id: 0, length: 1. };
  let resizing_note = Note { id: 1, length: 1. };
  container.add_note(4., blocking_note);
  container.add_note(1., resizing_note);
  let new_end_point = container.resize_note_end(1., resizing_note.id, 6.);
  assert_eq!(new_end_point, 4.);
}

#[test]
/// It should not be possible to move a note such that it is entirely within another note
pub fn prevent_moving_inside_other_notes() {
  let mut container = NoteContainer::default();
  let big_note = Note {
    id: 0,
    length: 100.,
  };
  let moving_note = Note { id: 1, length: 1. };
  container.add_note(0., big_note);
  container.add_note(105., moving_note);
  let new_start_point = container.move_note_horizontal(105., 1, 80.);
  assert_eq!(new_start_point, 100.);
}
