//! Synth state management.  Handles keeping track of what each voice of each polyphonic synth
//! is playing and passing the correct commands through to the WebAudio synths.

use std::{intrinsics::likely, mem, ptr};

use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "./synth")]
extern "C" {
    /// Initializes a synth on the JavaScript side, returning its index in the gloabl synth array.
    pub fn init_synth(voice_count: usize) -> usize;
    pub fn trigger_attack(synth_ix: usize, voice_ix: usize, frequency: f32);
    pub fn trigger_release(synth_ix: usize, voice_ix: usize);
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
    #[inline(always)]
    pub fn new(src_ix: usize) -> Self {
        Voice {
            playing: VoicePlayingStatus::Tacent,
            src_ix,
        }
    }
}

pub struct PolySynth {
    /// ID mapping this struct to the set of WebAudio voices on the JavaScript side
    id: usize,
    /// Index of the first voice slot that is idle.  If no slots are idle, points to the voice that
    /// has been playing the longest.
    idle_voice_ix: usize,
    /// Maps each voice's index to what frequency it's currently playing
    voices: [Voice; POLY_SYNTH_VOICE_COUNT],
}

impl PolySynth {
    pub fn new() -> Self {
        let mut voices: [Voice; POLY_SYNTH_VOICE_COUNT] = unsafe { mem::uninitialized() };
        let voices_ptr = &mut voices as *mut _ as *mut Voice;
        for i in 0..POLY_SYNTH_VOICE_COUNT {
            unsafe { ptr::write(voices_ptr.add(i), Voice::new(i)) };
        }
        let id = init_synth(POLY_SYNTH_VOICE_COUNT);

        PolySynth {
            id,
            idle_voice_ix: 0,
            voices,
        }
    }

    /// Starts playing a given frequency on one of the voices of the synthesizer.  If all of the
    /// voices are occupied, one of the other voices will be stopped and used to play this
    /// frequency.
    pub fn trigger_attack(&mut self, frequency: f32) {
        self.voices[self.idle_voice_ix].playing = VoicePlayingStatus::Playing(frequency);
        trigger_attack(self.id, self.voices[self.idle_voice_ix].src_ix, frequency);

        if self.idle_voice_ix == (POLY_SYNTH_VOICE_COUNT - 1) {
            self.idle_voice_ix = 0;
        } else {
            self.idle_voice_ix += 1;
        }
    }

    #[inline]
    pub fn trigger_attacks(&mut self, frequencies: &[f32]) {
        for frequency in frequencies {
            self.trigger_attack(*frequency);
        }
    }

    pub fn trigger_release(&mut self, frequency: f32) {
        // look for the index of the first voice that's playing the provided frequency
        let target_voice_ix = match self
            .voices
            .iter()
            .position(|voice| voice.playing == VoicePlayingStatus::Playing(frequency))
        {
            Some(pos) => pos,
            None => {
                common::warn(format!(
                    "Attempted to release frequency {} but it isn't being played.",
                    frequency
                ));
                return;
            },
        };
        trigger_release(self.id, self.voices[target_voice_ix].src_ix);

        if unsafe { likely(self.voices[self.idle_voice_ix].playing == VoicePlayingStatus::Tacent) }
        {
            // Decrement the idle voice ix and swap the last element of the voices array with the
            // index of the voice being released
            self.idle_voice_ix -= 1;
        } else {
            // All synth slots were currently full, so move our idle pointer to the end.
            self.idle_voice_ix = POLY_SYNTH_VOICE_COUNT - 1;
        }
        self.voices.swap(target_voice_ix, self.idle_voice_ix);
        self.voices[self.idle_voice_ix].playing = VoicePlayingStatus::Tacent;
    }

    #[inline]
    pub fn trigger_releases(&mut self, frequencies: &[f32]) {
        for frequency in frequencies {
            self.trigger_release(*frequency);
        }
    }
}
