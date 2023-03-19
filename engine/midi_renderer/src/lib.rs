//! Renders MIDI notes into a SVG that can be displayed as a minimap.

use svg::{node::element::Rectangle, Document};

use crate::conf::{MINIMAP_HEIGHT_PX, MIN_MIDI_NUMBER_RANGE, NOTE_COLOR};

mod conf;

static mut ENCODED_DATA_BUFFER: Vec<u8> = Vec::new();

#[no_mangle]
pub extern "C" fn get_encoded_notes_buf_ptr(encoded_byte_length: usize) -> *mut u8 {
  unsafe {
    ENCODED_DATA_BUFFER = Vec::with_capacity(encoded_byte_length);
    ENCODED_DATA_BUFFER.set_len(encoded_byte_length);
    ENCODED_DATA_BUFFER.as_mut_ptr()
  }
}

static mut RENDERED_SVG_TEXT: String = String::new();

#[repr(packed)]
struct EncodedMIDINote {
  pub midi_number: i32,
  pub start_time: f32,
  pub length: f32,
}

#[no_mangle]
pub extern "C" fn midi_minimap_render_minimap(_beats_per_measure: f32) -> *const u8 {
  let data_buf: &[u8] = unsafe { ENCODED_DATA_BUFFER.as_slice() };
  assert_eq!(data_buf.len() % 12, 0);
  let encoded_notes: &[EncodedMIDINote] = unsafe {
    std::slice::from_raw_parts(
      data_buf.as_ptr() as *const EncodedMIDINote,
      data_buf.len() / 12,
    )
  };

  let (min_midi_number, max_midi_number, _max_end_beat) = encoded_notes.iter().fold(
    (i32::MAX, i32::MIN, 0.0f32),
    |(min, max, max_end_beat), note| {
      (
        min.min(note.midi_number),
        max.max(note.midi_number),
        max_end_beat.max(note.start_time + note.length),
      )
    },
  );
  let (mut min_midi_number, mut max_midi_number) = (
    min_midi_number.max(0) as usize,
    max_midi_number.max(0) as usize,
  );
  if min_midi_number == 0 {
    max_midi_number += 2;
  } else {
    min_midi_number -= 1;
    max_midi_number += 1;
  }
  let mut midi_number_range = max_midi_number - min_midi_number;
  while midi_number_range < MIN_MIDI_NUMBER_RANGE {
    min_midi_number = min_midi_number.saturating_sub(1);
    max_midi_number += 1;
    midi_number_range = max_midi_number - min_midi_number;
  }
  let full_height = MINIMAP_HEIGHT_PX;
  let note_height = full_height as f32 / midi_number_range as f32;

  let mut doc = Document::new();

  for note in encoded_notes {
    if note.midi_number < 0 {
      continue;
    }
    let midi_number = note.midi_number as usize;

    let rect = Rectangle::new()
      .set("x", note.start_time)
      .set("y", (max_midi_number - midi_number) as f32 * note_height)
      .set("width", note.length)
      .set("height", note_height)
      .set("fill", NOTE_COLOR);
    doc = doc.add(rect);
  }

  unsafe { RENDERED_SVG_TEXT = String::new() };
  let svg_text: String = doc.to_string();
  unsafe {
    RENDERED_SVG_TEXT = svg_text;
    RENDERED_SVG_TEXT.as_bytes().as_ptr()
  }
}

#[no_mangle]
pub extern "C" fn midi_minimap_get_svg_text_length() -> usize { unsafe { RENDERED_SVG_TEXT.len() } }
