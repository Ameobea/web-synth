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
}
