//! Functions for dealing with streaming midi events from a MIDI controller

use js_sys::Function;
use rimd::{MidiMessage, Status};
use wasm_bindgen::prelude::*;

pub struct MsgHandlerContext {
    pub play_note: Function,
    pub release_note: Function,
    pub pitch_bend: Option<Function>,
    // TODO: Add handlers for other events
}

#[wasm_bindgen]
pub fn create_msg_handler_context(
    play_note: Function,
    release_note: Function,
    pitch_bend: Option<Function>,
) -> usize {
    crate::maybe_init();
    let ctx = Box::new(MsgHandlerContext {
        play_note,
        release_note,
        pitch_bend,
    });
    Box::into_raw(ctx) as usize
}

#[wasm_bindgen]
pub fn handle_midi_evt(evt_bytes: Vec<u8>, ctx_ptr: *mut MsgHandlerContext) {
    let ctx = unsafe { Box::from_raw(ctx_ptr) };
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

            ctx.play_note
                .call2(
                    &JsValue::NULL,
                    &JsValue::from(note_id),
                    &JsValue::from(velocity),
                )
                .map(|_| ())
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

            ctx.release_note
                .call2(
                    &JsValue::NULL,
                    &JsValue::from(note_id),
                    &JsValue::from(velocity),
                )
                .map(|_| ())
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
