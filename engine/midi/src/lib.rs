#[macro_use]
extern crate log;

use std::{convert::TryFrom, io::BufReader, u64};

use futures::prelude::*;
use js_sys::{Function, Promise, Uint8Array};
use miniserde::{json, Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{future_to_promise, JsFuture};

use rimd::{AbsoluteEvent, Event, MidiMessage, SMFWriter, Status, TrackEvent, SMF};

pub mod streaming;

const NO_PLAYING_NOTE: u64 = u64::MAX;

#[repr(packed)]
#[derive(Clone, Copy, Debug)]
pub struct RawNoteData {
  pub line_ix: u32,
  pub padding: u32,
  pub start_beat: f64,
  pub width: f64,
}

#[wasm_bindgen]
pub fn write_to_midi(name: String, note_data: &[u8]) -> Vec<u8> {
  let ticks_per_beat = 256.;
  common::maybe_init(None);
  wbg_logging::maybe_init();

  let notes: &[RawNoteData] = unsafe {
    std::slice::from_raw_parts(
      note_data.as_ptr() as *const _,
      note_data.len() / std::mem::size_of::<RawNoteData>(),
    )
  };

  let mut builder = rimd::SMFBuilder::new();
  let mut midi_events = Vec::with_capacity(notes.len() * 2);
  for note in notes {
    let start_ticks = (note.start_beat * ticks_per_beat) as u64;
    let end_ticks = start_ticks + (note.width * ticks_per_beat) as u64;

    midi_events.push(AbsoluteEvent::new_midi(
      start_ticks,
      MidiMessage::note_on(note.line_ix as u8, 255, 0),
    ));
    midi_events.push(AbsoluteEvent::new_midi(
      end_ticks,
      MidiMessage::note_off(note.line_ix as u8, 255, 0),
    ))
  }
  midi_events.sort_unstable_by_key(|evt| evt.get_time());
  builder.add_static_track(midi_events.iter());
  builder.set_name(0, name);

  let mut midi_file = builder.result();
  midi_file.division = ticks_per_beat as i16;

  let mut output: Vec<u8> = Vec::new();
  SMFWriter::from_smf(midi_file)
    .write_all(&mut output)
    .expect("Failed to write MIDI data to buffer");
  output
}

#[derive(Serialize)]
pub struct MIDITrackInfo {
  pub copyright: Option<String>,
  pub name: Option<String>,
}

#[derive(Serialize)]
pub struct MIDIFileInfo {
  pub tracks: Vec<MIDITrackInfo>,
  pub division: i16,
}

/// This settings object is returned from the JS side as the output of a form that tue user fills
/// in when loading a track.
#[derive(Deserialize)]
pub struct MidiLoadSettings {
  pub track_ix: usize,
}

impl From<&SMF> for MIDIFileInfo {
  fn from(smf: &SMF) -> Self {
    MIDIFileInfo {
      tracks: smf
        .tracks
        .iter()
        .map(|track| MIDITrackInfo {
          copyright: track.copyright.clone(),
          name: track.name.clone(),
        })
        .collect::<Vec<_>>(),
      division: smf.division,
    }
  }
}

/// Parses a MIDI file and calls `note_cb` with `(note_id, start_beat, length)` for each note in the
/// selected track as returned by `info_cb`.
///
/// `info_cb` is a function that should be called with the object representing stats about the
/// loaded MIDI file.  It should return a `Promise` which will then be awaited by this function.
/// That promise should resolve to the track to be loaded.
#[wasm_bindgen]
pub fn load_midi_to_raw_note_bytes(
  file_bytes: &[u8],
  info_cb: Function,
  note_cb: Function,
) -> Option<Promise> {
  common::maybe_init(None);
  wbg_logging::maybe_init();

  let mut reader = BufReader::new(file_bytes);
  let midi_file = SMF::from_reader(&mut reader).expect("Failed to parse supplied SMF file");
  let ticks_per_beat: i16 = midi_file.division;
  info!("ticks per beat: {}", ticks_per_beat);
  if ticks_per_beat <= 0 {
    panic!("Invalid `division` on MIDI file: {}", ticks_per_beat);
  }
  let ticks_per_beat = ticks_per_beat as f32;
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

  // Call the callback function and await the promise that it returns
  let file_info: MIDIFileInfo = MIDIFileInfo::from(&midi_file);
  let serialized_file_info: String = json::to_string(&file_info);
  let promise: Promise =
    match info_cb.call1(&JsValue::NULL, &JsValue::from_str(&serialized_file_info)) {
      Ok(res_js_value) => match Promise::try_from(res_js_value) {
        Ok(promise) => promise,
        Err(err) => {
          error!(
            "Error converting return value of `info_cb` to `Promise`: {:?}",
            err
          );
          return None;
        },
      },
      Err(err) => {
        error!(
          "What I assume to be a JS error occured when displaying parsed file info: {:?}",
          err
        );
        return None;
      },
    };

  let cb = move |res: Result<JsValue, JsValue>| -> Result<JsValue, JsValue> {
    let track_to_read = match res {
      Ok(track_to_read) => track_to_read,
      Err(err) => {
        error!("Got error from JS future: {:?}", err);
        return Err(JsValue::null());
      },
    };

    let track_to_read: usize = match track_to_read.as_f64() {
      Some(track_to_read) => track_to_read as usize,
      None => {
        error!("Error while trying to convert value passed to callback (exected usize)");
        return Err(JsValue::from(None as Option<Uint8Array>));
      },
    };

    if midi_file.tracks.get(track_to_read).is_none() {
      panic!("No track with specified index {} found!", track_to_read);
    }

    let track = &midi_file.tracks[track_to_read];
    info!("Reading events for track named {}", track);
    let mut cur_vtime = 0;
    let mut on_notes: [u64; 255] = [NO_PLAYING_NOTE; 255];

    struct NoteParseContext<'a> {
      cur_vtime: u64,
      on_notes: &'a mut [u64; 255],
      data: &'a [u8],
    }

    let handle_note_off = |NoteParseContext {
                             cur_vtime,
                             on_notes,
                             data,
                           }: &mut NoteParseContext| {
      let note_id = data[1];
      let velocity = data[2];
      trace!(
        "Note off event; vtime: {}, note_id: {}, velocity: {}",
        cur_vtime,
        note_id,
        velocity
      );

      if on_notes[note_id as usize] == NO_PLAYING_NOTE {
        warn!("Tried to turn off note id {} but it's not playing", note_id);
        return;
      }

      let note_start_ticks = on_notes[note_id as usize];
      let note_duration_beats = (*cur_vtime - note_start_ticks) as f32 / ticks_per_beat;
      let note_start_beats = note_start_ticks as f32 / ticks_per_beat;
      let _ = note_cb.call3(
        &JsValue::NULL,
        &JsValue::from(note_id),
        &JsValue::from(note_start_beats),
        &JsValue::from(note_duration_beats),
      );

      on_notes[note_id as usize] = NO_PLAYING_NOTE;
    };

    let handle_note_on = |context: &mut NoteParseContext| {
      let note_id = context.data[1];
      let velocity = context.data[2];
      debug!(
        "Note on event; vtime: {}, note_id: {}, velocity: {}",
        context.cur_vtime, note_id, velocity
      );

      if velocity == 0 {
        info!("Velocity is zero; handling as note off event.");
        handle_note_off(context);
      }

      if context.on_notes[note_id as usize] != NO_PLAYING_NOTE {
        warn!(
          "Tried to start note id {} but it's already playing",
          note_id
        );
        return;
      }

      context.on_notes[note_id as usize] = context.cur_vtime;
    };

    for TrackEvent { vtime, event } in &track.events {
      cur_vtime += vtime;
      trace!("cur_vtime={}, evt={:?}", cur_vtime, TrackEvent {
        vtime: *vtime,
        event: event.clone()
      });

      match event {
        Event::Meta(meta_evt) => info!("Ignoring meta event: {:?}", meta_evt),
        Event::Midi(midi_evt) => {
          let mut context = NoteParseContext {
            cur_vtime,
            on_notes: &mut on_notes,
            data: &midi_evt.data,
          };

          match midi_evt.status() {
            Status::NoteOn => handle_note_on(&mut context),
            Status::NoteOff => handle_note_off(&mut context),
            _ => info!(
              "Unhandled MIDI event of type {:?}: {:?}",
              midi_evt.status(),
              midi_evt
            ),
          }
        },
      }
    }

    Ok(JsValue::NULL)
  };

  // Convert the JS Promise into a Rust/JS hybrid promise from that external crate
  let future_promise: JsFuture = JsFuture::from(promise);
  // Chain on the handling logic for after the user selects which track they want, convert it back
  // into a JS Promise, and return it.
  Some(future_to_promise(future_promise.map(cb)))
}
