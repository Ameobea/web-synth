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
    pub voice_manager: PolySynth<
        Box<dyn Fn(String, usize) -> usize>,
        Box<dyn Fn(usize, usize, usize, u8)>,
        Box<dyn Fn(usize, usize)>,
        Box<dyn Fn(usize, usize, f32, f32)>,
        Box<dyn Fn(usize, &[u8], &[usize], &[f32])>,
    >,
    // TODO: Add handlers for other events
}

#[wasm_bindgen]
pub fn create_msg_handler_context(
    play_note: Function,
    release_note: Function,
    pitch_bend: Option<Function>,
) -> usize {
    crate::maybe_init();

    let mut ctx = Box::new(MsgHandlerContext {
        play_note,
        release_note,
        pitch_bend,
        // Insert temporary pointers for now that we will swap out once we have psueo-static
        // pointers to the boxed `Function`s
        voice_manager: PolySynth::new(uuid_v4(), true, SynthCallbacks {
            init_synth: Box::new(|_, _| 0usize),
            trigger_release: Box::new(|_, _| panic!()),
            trigger_attack: Box::new(|_, _, _, _: u8| panic!()),
            trigger_attack_release: Box::new(|_, _, _, _| panic!()),
            schedule_events: Box::new(|_, _, _, _| panic!()),
        }),
    });

    // Replace the temporary synth cb pointers with real ones
    let play_note: *const Function = &ctx.play_note as *const Function;
    let release_note: *const Function = &ctx.release_note as *const Function;
    let pitch_bend: Option<*const Function> =
        ctx.pitch_bend.as_ref().map(|pb| pb as *const Function); // TODO: Use

    let synth_cbs = SynthCallbacks {
        init_synth: Box::new(move |_, _| 0usize) as Box<dyn Fn(String, usize) -> usize>, // No-op
        trigger_attack: Box::new(
            move |_synth_ix: usize, voice_ix: usize, note_id: usize, velocity: u8| {
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
            },
        ) as Box<dyn Fn(usize, usize, usize, u8)>,
        trigger_release: Box::new(move |_synth_ix: usize, voice_ix: usize| {
            unsafe {
                match (&*release_note).call1(&JsValue::NULL, &JsValue::from(voice_ix as u32)) {
                    Ok(_) => (),
                    Err(err) => error!("Error playing note: {:?}", err),
                }
            };
        }) as Box<dyn Fn(usize, usize)>,
        trigger_attack_release: Box::new(move |_: usize, _: usize, _: f32, _: f32| unimplemented!())
            as Box<dyn Fn(usize, usize, f32, f32)>,
        schedule_events: Box::new(move |_, _: &[u8], _: &[usize], _: &[f32]| unimplemented!())
            as Box<dyn Fn(usize, &[u8], &[usize], &[f32])>,
    };
    mem::replace(&mut ctx.voice_manager.synth_cbs, synth_cbs);

    Box::into_raw(ctx) as usize
}

#[wasm_bindgen]
pub fn drop_msg_handler_ctx(ctx_ptr: *mut MsgHandlerContext) {
    drop(unsafe { Box::from_raw(ctx_ptr) })
}

#[wasm_bindgen]
pub fn handle_midi_evt(evt_bytes: Vec<u8>, ctx_ptr: *mut MsgHandlerContext) {
    let mut ctx = unsafe { Box::from_raw(ctx_ptr) };
    let evt = MidiMessage::from_bytes(evt_bytes);

    let res = match evt.status() {
        Status::NoteOn => {
            let note_id = evt.data[1];
            let velocity = evt.data[2];
            trace!(
                "{}; note_id: {}, velocity: {}",
                Status::NoteOn,
                note_id,
                velocity
            );

            ctx.voice_manager.trigger_attack(note_id as usize, velocity);
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

            ctx.voice_manager.trigger_release(note_id as usize);
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
