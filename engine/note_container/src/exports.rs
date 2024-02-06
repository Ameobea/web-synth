use std::ops::Bound;

use float_ord::FloatOrd;
use fxhash::FxHashMap;
use js_sys::Function;
use wasm_bindgen::prelude::*;

use crate::{
  note_container::{Note, NoteContainer, NoteEntry},
  note_lines::NoteLines,
};

#[wasm_bindgen]
pub fn create_note_lines(line_count: usize) -> *mut NoteLines {
  common::maybe_init(None);
  wbg_logging::maybe_init();
  let mut lines = Vec::with_capacity(line_count);
  for _ in 0..line_count {
    lines.push(NoteContainer::default())
  }
  Box::into_raw(Box::new(NoteLines { lines }))
}

#[wasm_bindgen]
pub fn free_note_lines(lines: *mut NoteLines) { unsafe { drop(Box::from_raw(lines)) } }

static mut NOTE_ID_COUNT: u32 = 0;

pub fn get_new_note_id() -> u32 {
  unsafe {
    NOTE_ID_COUNT += 1;
    NOTE_ID_COUNT
  }
}

#[wasm_bindgen]
pub fn create_note(
  lines: *mut NoteLines,
  line_ix: usize,
  start_point: f64,
  length: f64,
  note_id: u32,
) -> u32 {
  let notes = unsafe { &mut *lines };
  let container = &mut notes.lines[line_ix];
  let note_id = if note_id == 0 {
    get_new_note_id()
  } else {
    note_id
  };
  container.add_note(start_point, Note {
    id: note_id,
    length,
  });
  note_id
}

#[wasm_bindgen]
pub fn delete_note(lines: *mut NoteLines, line_ix: usize, start_point: f64, note_id: u32) {
  let notes = unsafe { &mut *lines };
  let container = &mut notes.lines[line_ix];
  container.remove_note(start_point, note_id);
}

#[wasm_bindgen]
pub fn move_note_horizontal(
  lines: *mut NoteLines,
  line_ix: usize,
  start_point: f64,
  note_id: u32,
  desired_new_start_point: f64,
) -> f64 {
  let notes = unsafe { &mut *lines };
  let container = &mut notes.lines[line_ix];
  container.move_note_horizontal(start_point, note_id, desired_new_start_point)
}

#[wasm_bindgen]
pub fn resize_note_horizontal_start(
  lines: *mut NoteLines,
  line_ix: usize,
  start_point: f64,
  note_id: u32,
  new_start_point: f64,
) -> f64 {
  let notes = unsafe { &mut *lines };
  let container = &mut notes.lines[line_ix];
  container.resize_note_start(start_point, note_id, new_start_point)
}

#[wasm_bindgen]
pub fn resize_note_horizontal_end(
  lines: *mut NoteLines,
  line_ix: usize,
  start_point: f64,
  note_id: u32,
  new_end_point: f64,
) -> f64 {
  let notes = unsafe { &mut *lines };
  let container = &mut notes.lines[line_ix];
  container.resize_note_end(start_point, note_id, new_end_point)
}

#[wasm_bindgen]
pub fn check_can_add_note(
  lines: *const NoteLines,
  line_ix: usize,
  start_point: f64,
  length: f64,
) -> bool {
  let notes = unsafe { &*lines };
  let container = &notes.lines[line_ix];
  container.check_can_add_note(start_point, length)
}

#[wasm_bindgen]
pub fn iter_notes(
  lines: *const NoteLines,
  start_line_ix: usize,
  end_line_ix: usize,
  start_point: f64,
  end_point: f64,
) -> Vec<u32> {
  let notes = unsafe { &*lines };
  notes.iter_notes(start_line_ix, end_line_ix, start_point, end_point)
}

/// Calls `cb` for each note in all lines. If `end_beat_exclusive` is negative, it will be treated
/// as unbounded.
///
/// `cb` is called with three arguments:
///
/// 1. an `is_attack` flag which is true if the note is starting and false if the note is ending
/// 2. line index
/// 3. beat
///
/// If `include_partial_notes` is true, then notes that intersect the start or end of the selection
/// will be included but truncated to the bounds of the selection.
#[wasm_bindgen]
pub fn iter_notes_with_cb(
  lines: *const NoteLines,
  start_beat_inclusive: f64,
  end_beat_exclusive: f64,
  cb: Function,
  include_partial_notes: bool,
) {
  let notes = unsafe { &*lines };

  struct UnreleasedNote {
    line_ix: usize,
    start_point: f64,
    note: Note,
  }

  struct NoteEvent {
    is_attack: bool,
    line_ix: usize,
    beat: f64,
  }

  let mut unreleased_notes: FxHashMap<u32, UnreleasedNote> = FxHashMap::default();
  let mut events: Vec<NoteEvent> = Vec::default();
  let iter = notes.lines.iter().enumerate().flat_map(|(line_ix, line)| {
    line
      .inner
      .range((
        Bound::Included(FloatOrd(start_beat_inclusive)),
        if end_beat_exclusive < 0. {
          Bound::Unbounded
        } else {
          Bound::Excluded(FloatOrd(end_beat_exclusive))
        },
      ))
      .map(move |(pos, entry)| (line_ix, pos.0, entry))
  });
  for (line_ix, pos, entry) in iter {
    match entry {
      NoteEntry::NoteStart { note } => {
        events.push(NoteEvent {
          is_attack: true,
          line_ix,
          beat: pos,
        });
        let existing = unreleased_notes.insert(note.id, UnreleasedNote {
          line_ix,
          start_point: pos,
          note: note.clone(),
        });
        assert!(
          existing.is_none(),
          "Note cannot be gated more than once before being released"
        );
      },
      NoteEntry::NoteEnd { note_id } => {
        let existing = unreleased_notes.remove(&note_id);

        if existing.is_none() && include_partial_notes {
          events.push(NoteEvent {
            is_attack: true,
            line_ix,
            beat: start_beat_inclusive,
          });
        }

        if existing.is_some() || include_partial_notes {
          events.push(NoteEvent {
            is_attack: false,
            line_ix,
            beat: pos,
          });
        }
      },
      NoteEntry::StartAndEnd {
        start_note,
        end_note_id,
      } => {
        // release before attack
        let existing = unreleased_notes.remove(&end_note_id);
        if existing.is_some() {
          events.push(NoteEvent {
            is_attack: false,
            line_ix,
            beat: pos,
          });
        }

        events.push(NoteEvent {
          is_attack: true,
          line_ix,
          beat: pos,
        });
        let existing = unreleased_notes.insert(start_note.id, UnreleasedNote {
          line_ix,
          start_point: pos,
          note: start_note.clone(),
        });
        assert!(
          existing.is_none(),
          "Note cannot be gated more than once before being released"
        );
      },
    }
  }

  // Make sure that we include the release events for notes that exceed the end of the selection
  if end_beat_exclusive < 0. {
    assert!(unreleased_notes.is_empty());
  }
  for note in unreleased_notes.values() {
    let release_time = note.start_point + note.note.length;
    events.push(NoteEvent {
      is_attack: false,
      line_ix: note.line_ix,
      beat: release_time,
    });
  }

  events.sort_unstable_by(|a, b| {
    FloatOrd(a.beat)
      .cmp(&FloatOrd(b.beat))
      .then_with(|| a.line_ix.cmp(&b.line_ix))
      // attacks before releases
      .then_with(|| a.is_attack.cmp(&b.is_attack).reverse())
  });

  for NoteEvent {
    is_attack,
    line_ix,
    beat,
  } in events
  {
    let _ = cb.call3(
      &JsValue::NULL,
      &JsValue::from(is_attack),
      &JsValue::from(line_ix as u32),
      &JsValue::from(beat),
    );
  }
}

#[wasm_bindgen]
pub fn set_line_count(lines: *mut NoteLines, new_line_count: usize) {
  let lines = unsafe { &mut *lines };

  while lines.lines.len() < new_line_count {
    lines.lines.push(NoteContainer::default());
  }
  while lines.lines.len() > new_line_count {
    lines.lines.pop();
  }
}
