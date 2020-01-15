//! Functions for dealing with streaming midi events from a MIDI controller

use std::mem;

use common::uuid_v4;
use js_sys::Function;
use polysynth::{PolySynth, SynthCallbacks};
use rimd::{MidiMessage, Status};
use wasm_bindgen::prelude::*;

pub struct MsgHandlerContext {
    pub play_note: Function,
    pub release_note: Function,
    pub pitch_bend: Option<Function>,
    pub mod_wheel: Option<Function>,
    pub voice_manager: PolySynth<
        Box<dyn Fn(String, usize) -> usize>,
        Box<dyn Fn(usize, usize, usize, u8, Option<f32>)>,
        Box<dyn Fn(usize, usize, usize, Option<f32>)>,
        Box<dyn Fn(usize, usize, f32, f32)>,
        Box<dyn Fn(usize, &[u8], &[usize], &[f32])>,
    >,
}

#[wasm_bindgen]
pub fn create_msg_handler_context(
    play_note: Function,
    release_note: Function,
    pitch_bend: Option<Function>,
    mod_wheel: Option<Function>,
) -> usize {
    common::maybe_init();

    let mut ctx = box MsgHandlerContext {
        play_note,
        release_note,
        pitch_bend,
        mod_wheel,
        // Insert temporary pointers for now that we will swap out once we have psueo-static
        // pointers to the boxed `Function`s
        voice_manager: PolySynth::new(uuid_v4(), true, SynthCallbacks {
            init_synth: box |_, _| 0usize,
            trigger_release: box |_, _, _, _| panic!(),
            trigger_attack: box |_, _, _, _, _| panic!(),
            trigger_attack_release: box |_, _, _, _| panic!(),
            schedule_events: box |_, _, _, _| panic!(),
        }),
    };

    // Replace the temporary synth cb pointers with real ones
    let play_note: *const Function = &ctx.play_note as *const Function;
    let release_note: *const Function = &ctx.release_note as *const Function;

    let synth_cbs = SynthCallbacks {
        init_synth: (box move |_, _| 0usize) as Box<dyn Fn(String, usize) -> usize>, // No-op
        trigger_attack: (box move |_synth_ix: usize,
                                   voice_ix: usize,
                                   note_id: usize,
                                   velocity: u8,
                                   offset: Option<f32>| {
            if (cfg!(debug_assertions) && offset.is_some()) {
                warn!(
                    "Offset provided to streaming synth attack CB, but it doesn't support \
                     offsets; ignoring"
                );
            }

            unsafe {
                match (&*play_note).call3(
                    &JsValue::NULL,
                    &JsValue::from(voice_ix as u32),
                    &JsValue::from(note_id as u32),
                    &JsValue::from(velocity),
                ) {
                    Ok(_) => (),
                    Err(err) => error!("Error playing note: {:?}", err),
                }
            };
        }) as Box<dyn Fn(usize, usize, usize, u8, Option<f32>)>,
        trigger_release: (box move |_synth_ix: usize,
                                    voice_ix: usize,
                                    note_id: usize,
                                    offset: Option<f32>| {
            if (cfg!(debug_assertions) && offset.is_some()) {
                warn!(
                    "Offset provided to streaming synth release CB, but it doesn't support \
                     offsets; ignoring"
                );
            }

            unsafe {
                match (&*release_note).call2(
                    &JsValue::NULL,
                    &JsValue::from(voice_ix as u32),
                    &JsValue::from(note_id as u32),
                ) {
                    Ok(_) => (),
                    Err(err) => error!("Error playing note: {:?}", err),
                }
            };
        }) as Box<dyn Fn(usize, usize, usize, Option<f32>)>,
        trigger_attack_release: (box move |_: usize, _: usize, _: f32, _: f32| unimplemented!())
            as Box<dyn Fn(usize, usize, f32, f32)>,
        schedule_events: (box move |_: usize, _: &[u8], _: &[usize], _: &[f32]| unimplemented!())
            as Box<dyn Fn(usize, &[u8], &[usize], &[f32])>,
    };
    mem::replace(&mut ctx.voice_manager.synth_cbs, synth_cbs);

    Box::into_raw(ctx) as usize
}

#[wasm_bindgen]
pub fn drop_msg_handler_ctx(ctx_ptr: *mut MsgHandlerContext) {
    let mut ctx = unsafe { Box::from_raw(ctx_ptr) };

    // Release all currently held notes
    ctx.voice_manager.release_all();

    drop(ctx)
}

#[wasm_bindgen]
pub fn handle_midi_evt(evt_bytes: Vec<u8>, ctx_ptr: *mut MsgHandlerContext) {
    let mut ctx = unsafe { Box::from_raw(ctx_ptr) };
    let evt = MidiMessage::from_bytes(evt_bytes);

    let res: Result<(), JsValue> = match evt.status() {
        Status::NoteOn => {
            let note_id = evt.data[1];
            let velocity = evt.data[2];
            trace!(
                "{}; note_id: {}, velocity: {}",
                Status::NoteOn,
                note_id,
                velocity
            );

            ctx.voice_manager
                .trigger_attack(note_id as usize, velocity, None);
            Ok(())
        },
        Status::NoteOff => {
            let note_id = evt.data[1];
            let velocity = evt.data[2];
            trace!(
                "{}; note_id: {}, velocity: {}",
                Status::NoteOff,
                note_id,
                velocity
            );

            ctx.voice_manager.trigger_release(note_id as usize, None);
            Ok(())
        },
        Status::PitchBend => match &ctx.pitch_bend {
            Some(pitch_bend) => {
                let lsb = evt.data[1];
                let msb = evt.data[2];

                pitch_bend
                    .call2(&JsValue::NULL, &JsValue::from(lsb), &JsValue::from(msb))
                    .map(|_| ())
            },
            None => {
                trace!("Ignoring pitch bend event since no pitch bend handler in context");
                Ok(())
            },
        },
        // Mod Wheel
        Status::ControlChange if evt.data[1] == 1 => {
            if let Some(mod_wheel_handler) = &ctx.mod_wheel {
                let value = evt.data[2];
                mod_wheel_handler
                    .call1(&JsValue::NULL, &JsValue::from(value))
                    .map(|_| ())
            } else {
                Ok(())
            }
        },
        status => {
            trace!("Unhandled MIDI event of type {}", status);
            Ok(())
        },
    };
    if let Err(err) = res {
        error!("Error executing MIDI event handler callback: {:?}", err);
    }

    std::mem::forget(ctx)
}
