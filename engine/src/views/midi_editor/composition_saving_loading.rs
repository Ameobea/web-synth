//! Functions for saving and loading compositions

use super::prelude::*;

use std::str;

pub fn serialize_and_save_composition() {
    // Get a list of every note in the composition matched with its line index
    let all_notes: Vec<RawNoteData> = state()
        .note_lines
        .lines
        .iter()
        .enumerate()
        .flat_map(|(line_ix, line)| {
            line.iter().map(move |note_box| RawNoteData {
                line_ix: line_ix as u32,
                start_beat: note_box.bounds.start_beat,
                width: note_box.bounds.width(),
            })
        })
        .collect();

    let mut base64_data = Vec::new();
    {
        let mut base64_encoder = base64::write::EncoderWriter::new(
            &mut base64_data,
            base64::Config::new(base64::CharacterSet::Standard, true),
        );
        bincode::serialize_into(&mut base64_encoder, &all_notes)
            .expect("Error binary-encoding note data");
        base64_encoder
            .finish()
            .expect("Error base64-encoding note data");
    }
    let base64_str = unsafe { str::from_utf8_unchecked(&base64_data) };

    js::save_composition(base64_str);
}

pub fn try_load_saved_composition() {
    let base64_data: String = match js::load_composition() {
        Some(data) => data,
        None => return,
    };

    let decoded_bytes: Vec<u8> = base64::decode(&base64_data).expect("Invalid base64 was saved.");
    let raw_notes: Vec<RawNoteData> = bincode::deserialize(&decoded_bytes)
        .expect("Unable to decode saved composition from raw bytes.");
    for raw_note in raw_notes {
        let RawNoteData {
            line_ix,
            start_beat,
            width,
        } = raw_note;
        let dom_id = render::draw_note(
            line_ix as usize,
            beats_to_px(start_beat),
            beats_to_px(width),
        );
        let insertion_error = state().note_lines.lines[line_ix as usize].insert(NoteBox {
            data: dom_id,
            bounds: NoteBoxBounds {
                start_beat,
                end_beat: start_beat + width,
            },
        });
        debug_assert!(!insertion_error);
    }
}
