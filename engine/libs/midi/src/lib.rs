#![feature(const_fn)]

use wasm_bindgen::prelude::*;

use common::RawNoteData;
use rimd::{AbsoluteEvent, MidiMessage, SMFWriter};

const TICKS_PER_BEAT: usize = 512;

const fn beats_to_ticks(beats: f32) -> u64 { (beats * (TICKS_PER_BEAT as f32)) as u64 }

#[wasm_bindgen]
pub fn write_to_midi(name: String, note_data: &[u8]) -> Vec<u8> {
    console_error_panic_hook::set_once();

    let notes: Vec<RawNoteData> =
        bincode::deserialize(note_data).expect("Error deserializing note data");

    let mut builder = rimd::SMFBuilder::new();
    let mut midi_events = Vec::with_capacity(notes.len() * 2);
    for note in notes {
        let start_ticks = beats_to_ticks(note.start_beat);
        let end_ticks = start_ticks + beats_to_ticks(note.width);

        midi_events.push(AbsoluteEvent::new_midi(
            start_ticks,
            MidiMessage::note_on(note.line_ix as u8, 255, 0),
        ));
        midi_events.push(AbsoluteEvent::new_midi(
            end_ticks,
            MidiMessage::note_off(note.line_ix as u8, 255, 0),
        ))
    }
    builder.add_static_track(midi_events.iter());
    builder.set_name(0, name);

    let midi_file = builder.result();

    let mut output: Vec<u8> = Vec::new();
    SMFWriter::from_smf(midi_file)
        .write_all(&mut output)
        .expect("Failed to write MIDI data to buffer");
    output
}
