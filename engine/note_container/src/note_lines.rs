use std::collections::HashSet;

use crate::note_container::NoteContainer;

/// Represents an array of `NoteContainer`s, matching the representation of the MIDI editor where
/// each note has its own container.
pub struct NoteLines {
  pub lines: Vec<NoteContainer>,
}

impl NoteLines {
  /// Returns `true` if the move was successful, `false` if it was blocked in the destination
  pub fn move_note_vertically(
    &mut self,
    src_line_ix: usize,
    dst_line_ix: usize,
    note_start: f64,
    note_id: u32,
  ) -> bool {
    let note = self.lines[src_line_ix].remove_note(note_start, note_id);
    let is_blocked = !self.lines[dst_line_ix].check_can_add_note(note_start, note.length);
    if is_blocked {
      self.lines[src_line_ix].add_note(note_start, note);
      return false;
    }
    self.lines[dst_line_ix].add_note(note_start, note);
    true
  }

  pub fn iter_notes(
    &self,
    start_line_ix: usize,
    end_line_ix: usize,
    start_point: f64,
    end_point: f64,
  ) -> Vec<u32> {
    let mut acc: HashSet<u32> = HashSet::new();
    for line_ix in start_line_ix..=end_line_ix.min(self.lines.len() - 1) {
      let line = &self.lines[line_ix];
      line.iter_notes(&mut acc, start_point, end_point);
    }
    acc.into_iter().collect()
  }
}
