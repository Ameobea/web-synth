//! Synth state management.  Handles keeping track of what each voice of each polyphonic synth
//! is playing and passing the correct commands through to the WebAudio synths.

#![feature(nll, box_syntax)]

#[cfg(feature = "wasm-bindgen")]
#[macro_use]
extern crate wasm_bindgen;
#[cfg(feature = "wasm-bindgen")]
extern crate common;
#[cfg(feature = "wasm-bindgen")]
extern crate js_sys;

#[macro_use]
extern crate log;

use std::{mem, ptr};

#[cfg(feature = "wasm-bindgen")]
use js_sys::Array;
use uuid::Uuid;

#[derive(Clone)]
pub struct SynthCallbacks<
    // uuid: String, voice_count: usize
    I: Fn(String, usize) -> usize,
    // synth_ix: usize, voice_ix: usize, note_id: usize, velocity: u8, offset: Option<f32>
    TA: Fn(usize, usize, usize, u8, Option<f32>),
    // synth_ix: usize, voice_ix: usize, note_id: usize, offset: Option<f32>
    TR: Fn(usize, usize, usize, Option<f32>),
    // synth_ix: usize, voice_ix: usize, frequency: f32, duration: f32
    TAR: Fn(usize, usize, f32, f32),
    // synth_ix: usize, events: &[u8], note_ids: &[usize], timings: &[f32]
    SE: Fn(usize, &[u8], &[usize], &[f32]),
> {
    pub init_synth: I,
    pub trigger_attack: TA,
    pub trigger_release: TR,
    pub trigger_attack_release: TAR,
    pub schedule_events: SE,
}

pub const POLY_SYNTH_VOICE_COUNT: usize = 10; // TODO: Make this a configurable param

#[derive(PartialEq, Clone, Copy, Debug)]
pub enum VoicePlayingStatus {
    Tacent,
    Playing(usize),
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

pub struct PolySynth<
    // uuid: String, voice_count: usize
    I: Fn(String, usize) -> usize,
    // synth_ix: usize, voice_ix: usize, note_id: usize, velocity: u8, offset: Option<f32>
    TA: Fn(usize, usize, usize, u8, Option<f32>),
    // synth_ix: usize, voice_ix: usize, note_id: usize, offset: Option<f32>
    TR: Fn(usize, usize, usize, Option<f32>),
    // synth_ix: usize, voice_ix: usize, frequency: f32, duration: f32
    TAR: Fn(usize, usize, f32, f32),
    // synth_ix: usize, events: &[u8], note_ids: &[usize], timings: &[f32]
    SE: Fn(usize, &[u8], &[usize], &[f32]),
> {
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
    /// The functions that will be called to carry out synth actions
    pub synth_cbs: SynthCallbacks<I, TA, TR, TAR, SE>,
}

impl<
        // uuid: String, voice_count: usize
        I: Fn(String, usize) -> usize,
        // synth_ix: usize, voice_ix: usize, note_id: usize, velocity: u8, offset: Option<f32>
        TA: Fn(usize, usize, usize, u8, Option<f32>),
        // synth_ix: usize, voice_ix: usize, note_id: usize, offset: Option<f32>
        TR: Fn(usize, usize, usize, Option<f32>),
        // synth_ix: usize, voice_ix: usize, frequency: f32, duration: f32
        TAR: Fn(usize, usize, f32, f32),
        // synth_ix: usize, events: &[u8], note_ids: &[usize], timings: &[f32]
        SE: Fn(usize, &[u8], &[usize], &[f32]),
    > PolySynth<I, TA, TR, TAR, SE>
{
    fn find_ix_of_voice_playing(&self, note_id: usize) -> Option<usize> {
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
        combined_search_range
            .map(|i| (i, unsafe { self.voices.get_unchecked(i) }))
            .find(|(_, voice)| voice.playing == VoicePlayingStatus::Playing(note_id))
            .map(|(ix, _voice)| ix)
    }

    pub fn new(uuid: Uuid, link: bool, synth_cbs: SynthCallbacks<I, TA, TR, TAR, SE>) -> Self {
        let mut voices: [Voice; POLY_SYNTH_VOICE_COUNT] =
            unsafe { mem::MaybeUninit::uninit().assume_init() };
        let voices_ptr = &mut voices as *mut _ as *mut Voice;
        for i in 0..POLY_SYNTH_VOICE_COUNT {
            unsafe { ptr::write(voices_ptr.add(i), Voice::new(i)) };
        }
        let id = if link && cfg!(target_arch = "wasm32") {
            (synth_cbs.init_synth)(uuid.to_string(), POLY_SYNTH_VOICE_COUNT)
        } else {
            0
        };

        PolySynth {
            id,
            first_active_voice_ix: 0,
            first_idle_voice_ix: 0,
            voices,
            synth_cbs,
        }
    }

    /// Starts playing a given frequency on one of the voices of the synthesizer.  If all of the
    /// voices are occupied, one of the other voices will be stopped and used to play this
    /// frequency.
    pub fn trigger_attack_cb<F: FnMut(usize, usize, usize, u8)>(
        &mut self,
        note_id: usize,
        velocity: u8,
        mut cb: F,
    ) -> Option<(usize, usize, usize, u8)> {
        // Ignore this event if we already have a note playing with the provided `note_id` on any
        // voice.  This is necessary in order to prevent "ghost" notes that can't be
        // released.
        if self.find_ix_of_voice_playing(note_id).is_some() {
            return None;
        }

        self.voices[self.first_idle_voice_ix].playing = VoicePlayingStatus::Playing(note_id);
        let played_voice_ix = self.voices[self.first_idle_voice_ix].src_ix;
        cb(self.id, played_voice_ix, note_id, velocity);

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

        Some((self.id, played_voice_ix, note_id, velocity))
    }

    pub fn trigger_attack(&mut self, note_id: usize, velocity: u8, offset: Option<f32>) {
        if let Some((synth_id, voice_ix, note_id, velocity)) =
            self.trigger_attack_cb(note_id, velocity, |_, _, _, _| ())
        {
            (self.synth_cbs.trigger_attack)(synth_id, voice_ix, note_id, velocity, offset);
        }
    }

    pub fn trigger_attacks(&mut self, note_ids: &[usize], velocity: u8) {
        for note_id in note_ids {
            self.trigger_attack(*note_id, velocity, None);
        }
    }

    pub fn trigger_release_cb<F: FnMut(usize, usize, usize)>(
        &mut self,
        note_id: usize,
        mut cb: F,
    ) -> Option<(usize, usize)> {
        let target_voice_ix = match self.find_ix_of_voice_playing(note_id) {
            Some(target_voice_ix) => target_voice_ix,
            None => {
                warn!(
                    "Attempted to release note id {} but it isn't being played.",
                    note_id
                );
                return None;
            },
        };

        let released_voice_ix = self.voices[target_voice_ix].src_ix;
        cb(self.id, released_voice_ix, note_id);
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

        Some((self.id, released_voice_ix))
    }

    pub fn trigger_release(&mut self, note_id: usize, offset: Option<f32>) {
        if let Some((synth_ix, voice_id)) = self.trigger_release_cb(note_id, |_, _, _| ()) {
            (self.synth_cbs.trigger_release)(synth_ix, voice_id, note_id, offset);
        }
    }

    pub fn trigger_releases(&mut self, note_ids: &[usize]) {
        for note_id in note_ids {
            self.trigger_release(*note_id, None);
        }
    }

    pub fn release_all(&mut self) {
        for i in 0..POLY_SYNTH_VOICE_COUNT {
            if let VoicePlayingStatus::Playing(note_id) = self.voices[i].playing {
                self.trigger_release(note_id, None);
            }
        }
    }
}

pub fn stop_playback() {
    // TODO
}

#[cfg(feature = "wasm-bindgen")]
pub mod exports {
    use wasm_bindgen::prelude::*;

    use crate::*;

    pub struct PolySynthContext {
        pub synth: PolySynth<
            Box<dyn Fn(String, usize) -> usize>,
            Box<dyn Fn(usize, usize, usize, u8, Option<f32>)>,
            Box<dyn Fn(usize, usize, usize, Option<f32>)>,
            Box<dyn Fn(usize, usize, f32, f32)>,
            Box<dyn Fn(usize, &[u8], &[usize], &[f32])>,
        >,
    }

    #[wasm_bindgen]
    pub fn create_polysynth_context(
        play_note: js_sys::Function,
        release_note: js_sys::Function,
    ) -> *mut PolySynthContext {
        let context = PolySynthContext {
            synth: PolySynth::new(common::uuid_v4(), true, SynthCallbacks {
                init_synth: box |_, _| 0usize,
                trigger_release:
                    box move |_synth_ix: usize,
                              voice_ix: usize,
                              note_id: usize,
                              offset: Option<f32>| {
                        match release_note.call3(
                            &JsValue::NULL,
                            &JsValue::from(voice_ix as u32),
                            &JsValue::from(note_id as u32),
                            &JsValue::from(offset),
                        ) {
                            Ok(_) => (),
                            Err(err) => error!("Error playing note: {:?}", err),
                        }
                    },
                trigger_attack: box move |_synth_ix: usize,
                                          voice_ix: usize,
                                          note_id: usize,
                                          velocity: u8,
                                          offset: Option<f32>| {
                    match play_note.apply(
                        &JsValue::NULL,
                        &Array::of4(
                            &JsValue::from(voice_ix as u32),
                            &JsValue::from(note_id as u32),
                            &JsValue::from(velocity),
                            &JsValue::from(offset),
                        ),
                    ) {
                        Ok(_) => (),
                        Err(err) => error!("Error playing note: {:?}", err),
                    }
                },
                trigger_attack_release: box move |_, _, _, _| unimplemented!(),
                schedule_events: box move |_, _, _, _| unimplemented!(),
            }),
        };

        Box::into_raw(box context)
    }

    #[wasm_bindgen]
    pub fn drop_polysynth_context(ctx: *mut PolySynthContext) {
        let mut ctx = unsafe { Box::from_raw(ctx) };
        ctx.synth.release_all();
        drop(ctx);
    }

    #[wasm_bindgen]
    pub fn handle_note_down(
        ctx: *mut PolySynthContext,
        note_id: usize,
        velocity: Option<u8>,
        offset: Option<f32>,
    ) {
        let mut ctx = unsafe { Box::from_raw(ctx) };
        ctx.synth
            .trigger_attack(note_id, velocity.unwrap_or(255), offset);
        mem::forget(ctx);
    }

    #[wasm_bindgen]
    pub fn handle_note_up(ctx: *mut PolySynthContext, note_id: usize, offset: Option<f32>) {
        let mut ctx = unsafe { Box::from_raw(ctx) };
        ctx.synth.trigger_release(note_id, offset);
        mem::forget(ctx);
    }

    #[wasm_bindgen]
    pub fn release_all(ctx: *mut PolySynthContext) {
        let mut ctx = unsafe { Box::from_raw(ctx) };
        ctx.synth.release_all();
        mem::forget(ctx);
    }
}
