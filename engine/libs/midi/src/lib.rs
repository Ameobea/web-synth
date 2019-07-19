#![feature(const_fn, nll)]

#[macro_use]
extern crate log;

use std::{io::BufReader, u64};

use wasm_bindgen::prelude::*;

use common::RawNoteData;
use rimd::{AbsoluteEvent, Event, MidiMessage, SMFWriter, Status, TrackEvent, SMF};

const TICKS_PER_BEAT: u64 = 512;

const NO_PLAYING_NOTE: u64 = u64::MAX;

const fn beats_to_ticks(beats: f32) -> u64 { (beats * (TICKS_PER_BEAT as f32)) as u64 }

const fn ticks_to_beats(ticks: u64) -> f32 { ticks as f32 / TICKS_PER_BEAT as f32 }

static mut INITED: bool = false;

fn maybe_init() {
    unsafe {
        if INITED {
            return;
        } else {
            INITED = true;
        }
    }

    console_error_panic_hook::set_once();
    wasm_logger::init(wasm_logger::Config::new(log::Level::Debug));
}

#[wasm_bindgen]
pub fn write_to_midi(name: String, note_data: &[u8]) -> Vec<u8> {
    maybe_init();

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

/// Parses a MIDI file and returns the serialize byte representation of the `RawNote`s loaded from
/// it.
#[wasm_bindgen]
pub fn load_midi_to_raw_note_bytes(file_bytes: &[u8], track_to_read: usize) -> Vec<u8> {
    maybe_init();

    let mut reader = BufReader::new(file_bytes);
    let midi_file = SMF::from_reader(&mut reader).expect("Failed to parse supplied SMF file");
    let track_titles_str = midi_file
        .tracks
        .iter()
        .enumerate()
        .map(|(i, track)| {
            let track_title = track
                .name
                .as_ref()
                .map(String::as_str)
                .unwrap_or("<untitled>");
            format!("{}: {}", i, track_title)
        })
        .collect::<Vec<String>>()
        .join(", ");

    info!(
        "Loaded SMF file.  Found {} tracks: {}",
        midi_file.tracks.len(),
        track_titles_str
    );

    if midi_file.tracks.is_empty() {
        panic!("Provided MIDI file with no tracks!");
    } else if midi_file.tracks.get(track_to_read).is_none() {
        panic!("No track with specified index {} found!", track_to_read);
    }

    let track = &midi_file.tracks[track_to_read];
    info!("Reading events for track named {}", track);
    let mut cur_vtime = 0;
    let mut notes: Vec<RawNoteData> = Vec::new();
    let mut on_notes: [u64; 255] = [NO_PLAYING_NOTE; 255];

    // TODO: Convert this to context struct rather than all these args
    let handle_note_off =
        |cur_vtime: u64, on_notes: &mut [u64; 255], notes: &mut Vec<RawNoteData>, data: &[u8]| {
            let note_id = data[1];
            let velocity = data[2];
            info!(
                "Note off event; vtime: {}, note_id: {}, velocity: {}",
                cur_vtime, note_id, velocity
            );

            if on_notes[note_id as usize] == NO_PLAYING_NOTE {
                warn!("Tried to turn off note id {} but it's not playing", note_id);
                return;
            }

            let note_beats = ticks_to_beats(cur_vtime - on_notes[note_id as usize]);
            let note_data = RawNoteData {
                line_ix: note_id as usize, // TODO: Properly convert this once we know how
                start_beat: ticks_to_beats(on_notes[note_id as usize]),
                width: note_beats,
            };
            notes.push(note_data);

            on_notes[note_id as usize] = NO_PLAYING_NOTE;
        };

    // TODO: Convert this to context struct rather than all these args
    let handle_note_on =
        |cur_vtime: u64, on_notes: &mut [u64; 255], notes: &mut Vec<RawNoteData>, data: &[u8]| {
            let note_id = data[1];
            let velocity = data[2];
            info!(
                "Note on event; vtime: {}, note_id: {}, velocity: {}",
                cur_vtime, note_id, velocity
            );

            if velocity == 0 {
                info!("Velocity is zero; handling as note off event.");
                handle_note_off(cur_vtime, on_notes, notes, data);
            }

            if on_notes[note_id as usize] != NO_PLAYING_NOTE {
                warn!(
                    "Tried to start note id {} but it's already playing",
                    note_id
                );
                return;
            }

            on_notes[note_id as usize] = cur_vtime;
        };

    for TrackEvent { vtime, event } in &track.events {
        cur_vtime += vtime;

        match event {
            Event::Meta(meta_evt) => info!("Ignoring meta event: {:?}", meta_evt),
            Event::Midi(midi_evt) => match midi_evt.status() {
                Status::NoteOn =>
                    handle_note_on(cur_vtime, &mut on_notes, &mut notes, &midi_evt.data),
                Status::NoteOff =>
                    handle_note_off(cur_vtime, &mut on_notes, &mut notes, &midi_evt.data),
                _ => info!(
                    "Unhandled MIDI event of type {:?}: {:?}",
                    midi_evt.status(),
                    midi_evt
                ),
            },
        }
    }

    bincode::serialize(&notes).expect("Error serializing raw note data vector")
}
