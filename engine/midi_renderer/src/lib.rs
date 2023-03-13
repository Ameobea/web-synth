#![feature(box_syntax)]

//! Renders MIDI notes into a SVG that can be displayed as a minimap.

use svg::{node::element::Rectangle, Document};

use crate::conf::{MINIMAP_HEIGHT_PX, NOTE_COLOR};

mod conf;

static mut ENCODED_DATA_BUFFER: *mut Vec<u8> = std::ptr::null_mut();

#[no_mangle]
pub extern "C" fn get_encoded_notes_buf_ptr(encoded_byte_length: usize) -> *mut u8 {
  if unsafe { ENCODED_DATA_BUFFER.is_null() } {
    let encoded_data_buffer = Vec::with_capacity(encoded_byte_length);
    unsafe { ENCODED_DATA_BUFFER = Box::into_raw(box encoded_data_buffer) };
  }
  let encoded_data_buffer = unsafe { &mut *ENCODED_DATA_BUFFER };

  let needed_additional_capacity =
    encoded_byte_length.saturating_sub(encoded_data_buffer.capacity());
  if needed_additional_capacity > 0 {
    encoded_data_buffer.reserve(needed_additional_capacity);
  }
  unsafe { encoded_data_buffer.set_len(encoded_byte_length) };
  encoded_data_buffer.as_mut_ptr()
}

static mut RENDERED_SVG_TEXT: String = String::new();

struct EncodedMIDINote {
  pub midi_number: i32,
  pub start_time: f32,
  pub length: f32,
}

#[no_mangle]
pub extern "C" fn midi_minimap_render_minimap() -> *const u8 {
  let data_buf: &[u8] = unsafe { &*ENCODED_DATA_BUFFER };
  assert_eq!(data_buf.len() % 12, 0);
  let encoded_notes: &[EncodedMIDINote] = unsafe {
    std::slice::from_raw_parts(
      data_buf.as_ptr() as *const EncodedMIDINote,
      data_buf.len() / 12,
    )
  };

  let (min_midi_number, max_midi_number) = encoded_notes
    .iter()
    .fold((i32::MAX, i32::MIN), |(min, max), note| {
      (min.min(note.midi_number), max.max(note.midi_number))
    });
  let full_height = MINIMAP_HEIGHT_PX;
  let note_height = full_height as f32 / (max_midi_number - min_midi_number) as f32;

  let mut doc = Document::new();
  for note in encoded_notes {
    let rect = Rectangle::new()
      .set("x", note.start_time)
      .set(
        "y",
        (max_midi_number - note.midi_number) as f32 * note_height,
      )
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
