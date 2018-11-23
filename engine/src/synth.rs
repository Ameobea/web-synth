//! Synth state management.  Handles keeping track of what each voice of each polyphonic synth
//! is playing and passing the correct commands through to the WebAudio synths.

use std::{mem, ptr};

use wasm_bindgen::prelude::*;

use super::{
    state::{state, BPM},
    util::{midi_to_frequency, tern},
};

#[wasm_bindgen(module = "./synth")]
extern "C" {
    /// Initializes a synth on the JavaScript side, returning its index in the gloabl synth array.
    pub fn init_synth(voice_count: usize) -> usize;
    pub fn trigger_attack(synth_ix: usize, voice_ix: usize, frequency: f32);
    pub fn trigger_release(synth_ix: usize, voice_ix: usize);
    pub fn trigger_attack_release(synth_ix: usize, voice_ix: usize, frequency: f32, duration: f32);
    pub fn schedule_events(synth_ix: usize, events: &[u8], frequencies: &[f32], timings: &[f32]);
}

pub const POLY_SYNTH_VOICE_COUNT: usize = 64;

#[derive(PartialEq, Clone, Copy, Debug)]
pub enum VoicePlayingStatus {
    Tacent,
    Playing(f32),
}

#[derive(Clone, Copy, Debug)]
pub struct Voice {
    pub playing: VoicePlayingStatus,
    /// Index mapping this voice to its position in the array of voices on the JavaScript/WebAudio
    /// side of things.
    pub src_ix: usize,
}

impl Voice {
    pub fn new(src_ix: usize) -> Self {
        Voice {
            playing: VoicePlayingStatus::Tacent,
            src_ix,
        }
    }

    pub fn is_playing(&self) -> bool {
        if self.playing == VoicePlayingStatus::Tacent {
            false
        } else {
            true
        }
    }
}

pub struct PolySynth {
    /// ID mapping this struct to the set of WebAudio voices on the JavaScript side
    id: usize,
    /// Index of the first voice slot that is playing.  If no slots are playing, points to an
    /// arbitrary slot.
    first_active_voice_ix: usize,
    /// Index of the first voice slot that is idle.  If no slots are idle,
    /// points to the voice that has been playing the longest.
    first_idle_voice_ix: usize,
    /// Maps each voice's index to what frequency it's currently playing
    voices: [Voice; POLY_SYNTH_VOICE_COUNT],
}

impl PolySynth {
    pub fn new(link: bool) -> Self {
        let mut voices: [Voice; POLY_SYNTH_VOICE_COUNT] = unsafe { mem::uninitialized() };
        let voices_ptr = &mut voices as *mut _ as *mut Voice;
        for i in 0..POLY_SYNTH_VOICE_COUNT {
            unsafe { ptr::write(voices_ptr.add(i), Voice::new(i)) };
        }
        let id = if link {
            init_synth(POLY_SYNTH_VOICE_COUNT)
        } else {
            0
        };

        PolySynth {
            id,
            first_active_voice_ix: 0,
            first_idle_voice_ix: 0,
            voices,
        }
    }

    /// Starts playing a given frequency on one of the voices of the synthesizer.  If all of the
    /// voices are occupied, one of the other voices will be stopped and used to play this
    /// frequency.
    pub fn trigger_attack_cb<F: FnMut(usize, usize, f32)>(&mut self, frequency: f32, mut cb: F) {
        self.voices[self.first_idle_voice_ix].playing = VoicePlayingStatus::Playing(frequency);
        cb(
            self.id,
            self.voices[self.first_idle_voice_ix].src_ix,
            frequency,
        );

        // bump the first idle index since we're adding a new active voice
        if self.first_idle_voice_ix == (POLY_SYNTH_VOICE_COUNT - 1) {
            self.first_idle_voice_ix = 0;
        } else {
            self.first_idle_voice_ix += 1;
        }

        // If all voices are active and we're overwriting the oldest voice, bump the first active
        // voice index forward.
        if self.voices[self.first_idle_voice_ix].is_playing() {
            self.first_active_voice_ix = self.first_idle_voice_ix;
        }
    }

    pub fn trigger_attack(&mut self, frequency: f32) {
        self.trigger_attack_cb(frequency, trigger_attack);
    }

    pub fn trigger_attacks(&mut self, frequencies: &[f32]) {
        for frequency in frequencies {
            self.trigger_attack(*frequency);
        }
    }

    pub fn trigger_release_cb<F: FnMut(usize, usize)>(&mut self, frequency: f32, mut cb: F) {
        // look for the index of the first voice that's playing the provided frequency
        let (search_range_1, search_range_2) = if self.voices[self.first_idle_voice_ix].is_playing()
        {
            // all voices active; have to search the whole range
            (0..POLY_SYNTH_VOICE_COUNT, 0..0)
        } else {
            if self.first_active_voice_ix > self.first_idle_voice_ix {
                // range is split; idle range is in the middle
                (
                    self.first_active_voice_ix..POLY_SYNTH_VOICE_COUNT,
                    0..self.first_idle_voice_ix,
                )
            } else {
                (self.first_active_voice_ix..self.first_idle_voice_ix, 0..0)
            }
        };
        let combined_search_range = search_range_1.chain(search_range_2);
        let (target_voice_ix, _) = match combined_search_range
            .map(|i| (i, unsafe { self.voices.get_unchecked(i) }))
            .find(|(_, voice)| voice.playing == VoicePlayingStatus::Playing(frequency))
        {
            Some(pos) => pos,
            None => {
                if cfg!(debug_assertions) {
                    common::warn(format!(
                        "Attempted to release frequency {} but it isn't being played.",
                        frequency
                    ));
                }
                return;
            },
        };
        cb(self.id, self.voices[target_voice_ix].src_ix);
        self.voices[target_voice_ix].playing = VoicePlayingStatus::Tacent;
        let old_first_active_voice_ix = self.first_active_voice_ix;

        // Bump the first active pointer forward since we're getting rid of an active voice
        if self.first_active_voice_ix != POLY_SYNTH_VOICE_COUNT - 1 {
            self.first_active_voice_ix += 1;
        } else {
            self.first_active_voice_ix = 0;
        }

        // swap the newly released voice into the slot that was just freed up, making sure that its
        // voice will not be re-used for as long as possible.
        self.voices.swap(target_voice_ix, old_first_active_voice_ix);
    }

    pub fn trigger_release(&mut self, frequency: f32) {
        self.trigger_release_cb(frequency, trigger_release);
    }

    pub fn trigger_releases(&mut self, frequencies: &[f32]) {
        for frequency in frequencies {
            self.trigger_release(*frequency);
        }
    }
}

pub fn start_playback() {
    // Get an iterator of sorted attack/release events to process
    let events = state().note_lines.iter_events(None);

    // Create a virtual poly synth to handle assigning the virtual notes to voices
    let mut voice_manager = PolySynth::new(false);

    // Trigger all of the events with a custom callback that records the voice index to use for each
    // of them.
    // `scheduled_events` is an array of `(is_attack, voice_ix)` pairs represented as bytes for
    // efficient transfer across the FFI.
    let mut scheduled_events: Vec<u8> = Vec::with_capacity(events.size_hint().0 * 2);
    let mut frequencies: Vec<f32> = Vec::with_capacity(events.size_hint().0 / 2);
    let mut event_timings: Vec<f32> = Vec::with_capacity(events.size_hint().0);
    for event in events {
        let frequency = midi_to_frequency(event.line_ix);
        scheduled_events.push(tern(event.is_start, 1, 0));
        let event_time_seconds = ((event.beat / BPM) * 60.0) / 4.0;
        event_timings.push(event_time_seconds);

        if event.is_start {
            frequencies.push(frequency);
            voice_manager.trigger_attack_cb(frequency, |_, voice_ix, _| {
                scheduled_events.push(voice_ix as u8);
            });
        } else {
            voice_manager.trigger_release_cb(frequency, |_, voice_ix| {
                scheduled_events.push(voice_ix as u8);
            });
        }
    }

    // Ship all of these events over to be scheduled and played
    schedule_events(
        state().synth.id,
        &scheduled_events,
        &frequencies,
        &event_timings,
    );
}

pub fn stop_playback() {
    // TODO
}
