//! Synth state management.  Handles keeping track of what each voice of each polyphonic synth
//! is playing and passing the correct commands through to the WebAudio synths.

use std::{mem, ptr};

use uuid::Uuid;

use super::prelude::*;

#[wasm_bindgen(raw_module = "./synth")]
extern "C" {
    /// Initializes a synth on the JavaScript side, returning its index in the gloabl synth array.
    pub fn init_synth(uuid: String, voice_count: usize) -> usize;
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

    pub fn is_playing(&self) -> bool { !(self.playing == VoicePlayingStatus::Tacent) }
}

pub struct PolySynth {
    /// ID mapping this struct to the set of WebAudio voices on the JavaScript side
    pub id: usize,
    /// Index of the first voice slot that is playing.  If no slots are playing, points to an
    /// arbitrary slot.
    pub first_active_voice_ix: usize,
    /// Index of the first voice slot that is idle.  If no slots are idle,
    /// points to the voice that has been playing the longest.
    pub first_idle_voice_ix: usize,
    /// Maps each voice's index to what frequency it's currently playing
    pub voices: [Voice; POLY_SYNTH_VOICE_COUNT],
}

impl PolySynth {
    pub fn new(uuid: Uuid, link: bool) -> Self {
        let mut voices: [Voice; POLY_SYNTH_VOICE_COUNT] = unsafe { mem::uninitialized() };
        let voices_ptr = &mut voices as *mut _ as *mut Voice;
        for i in 0..POLY_SYNTH_VOICE_COUNT {
            unsafe { ptr::write(voices_ptr.add(i), Voice::new(i)) };
        }
        let id = if link && cfg!(target_arch = "wasm32") {
            init_synth(uuid.to_string(), POLY_SYNTH_VOICE_COUNT)
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
        } else if self.first_active_voice_ix > self.first_idle_voice_ix {
            // range is split; idle range is in the middle
            (
                self.first_active_voice_ix..POLY_SYNTH_VOICE_COUNT,
                0..self.first_idle_voice_ix,
            )
        } else {
            (self.first_active_voice_ix..self.first_idle_voice_ix, 0..0)
        };
        let combined_search_range = search_range_1.chain(search_range_2);
        let (target_voice_ix, _) = match combined_search_range
            .map(|i| (i, unsafe { self.voices.get_unchecked(i) }))
            .find(|(_, voice)| voice.playing == VoicePlayingStatus::Playing(frequency))
        {
            Some(pos) => pos,
            None => {
                warn!(
                    "Attempted to release frequency {} but it isn't being played.",
                    frequency
                );
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

pub fn stop_playback() {
    // TODO
}
