//! Synth state management.  Handles keeping track of what each voice of each polyphonic synth
//! is playing and passing the correct commands through to the WebAudio synths.

use std::{intrinsics::likely, mem, ptr};

pub const POLY_SYNTH_VOICE_COUNT: usize = 64;

#[derive(PartialEq, Clone, Copy)]
pub enum VoicePlayingStatus {
    Tacent,
    Playing(f32),
}

#[derive(Clone, Copy)]
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

pub fn trigger_wa_attack(synth_id: usize, voice_ix: usize, frequency: f32) {
    unimplemented!(); // TODO
}

pub fn trigger_wa_release(synth_id: usize, voice_ix: usize) {
    unimplemented!(); // TODO
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
    pub fn new(id: usize) -> Self {
        let mut voices: [Voice; POLY_SYNTH_VOICE_COUNT] = unsafe { mem::uninitialized() };
        let voices_ptr = &mut voices as *mut _ as *mut Voice;
        for i in 0..POLY_SYNTH_VOICE_COUNT {
            unsafe { ptr::write(voices_ptr.add(i), Voice::new(i)) };
        }

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
        trigger_wa_attack(self.id, self.voices[self.idle_voice_ix].src_ix, frequency);

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
            None => return,
        };
        trigger_wa_release(self.id, self.voices[target_voice_ix].src_ix);

        if unsafe { likely(self.voices[self.idle_voice_ix].playing == VoicePlayingStatus::Tacent) }
        {
            // Decrement the idle voice ix and swap the last element of the voices array with the
            // index of the voice being released
            self.idle_voice_ix -= 1;
        } else {
            // All synth slots were currently full, so move our idle pointer to the end.
            self.idle_voice_ix = POLY_SYNTH_VOICE_COUNT - 1;
        }
        self.voices[target_voice_ix] = self.voices[self.idle_voice_ix];
        self.voices[self.idle_voice_ix].playing = VoicePlayingStatus::Tacent;
        unimplemented!();
    }

    #[inline]
    pub fn trigger_releases(&mut self, frequencies: &[f32]) {
        for frequency in frequencies {
            self.trigger_release(*frequency);
        }
    }
}
