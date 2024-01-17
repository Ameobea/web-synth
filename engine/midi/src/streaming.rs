//! Functions for dealing with streaming midi events from a MIDI controller

use std::mem;

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
    Box<dyn Fn(usize, usize, u8, Option<f32>)>,
    Box<dyn Fn(usize, usize, Option<f32>)>,
    16,
  >,
  pub generic_control_handler: Option<Function>,
}

#[wasm_bindgen]
pub fn create_msg_handler_context(
  play_note: Function,
  release_note: Function,
  pitch_bend: Option<Function>,
  mod_wheel: Option<Function>,
  generic_control_handler: Option<Function>,
) -> usize {
  common::maybe_init(None);
  wbg_logging::maybe_init();

  let mut ctx = Box::new(MsgHandlerContext {
    play_note,
    release_note,
    pitch_bend,
    mod_wheel,
    // Insert temporary pointers for now that we will swap out once we have psueo-static
    // pointers to the boxed `Function`s
    voice_manager: PolySynth::new(SynthCallbacks {
      trigger_release: Box::new(|_, _, _| panic!()),
      trigger_attack: Box::new(|_, _, _, _| panic!()),
    }),
    generic_control_handler,
  });

  // Replace the temporary synth cb pointers with real ones
  let play_note: *const Function = &ctx.play_note as *const Function;
  let release_note: *const Function = &ctx.release_note as *const Function;

  let synth_cbs = SynthCallbacks {
    trigger_attack: (Box::new(
      move |voice_ix: usize, note_id: usize, velocity: u8, offset: Option<f32>| {
        if cfg!(debug_assertions) && offset.is_some() {
          warn!(
            "Offset provided to streaming synth attack CB, but it doesn't support offsets; \
             ignoring"
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
      },
    )) as Box<dyn Fn(usize, usize, u8, Option<f32>)>,
    trigger_release: (Box::new(
      move |voice_ix: usize, note_id: usize, offset: Option<f32>| {
        if cfg!(debug_assertions) && offset.is_some() {
          warn!(
            "Offset provided to streaming synth release CB, but it doesn't support offsets; \
             ignoring"
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
      },
    )) as Box<dyn Fn(usize, usize, Option<f32>)>,
  };
  let _ = mem::replace(&mut ctx.voice_manager.synth_cbs, synth_cbs);

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

      ctx
        .voice_manager
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
    Status::ControlChange if evt.data[1] == 1 =>
      if let Some(mod_wheel_handler) = &ctx.mod_wheel {
        let value = evt.data[2];
        mod_wheel_handler
          .call1(&JsValue::NULL, &JsValue::from(value))
          .map(|_| ())
      } else {
        Ok(())
      },
    status =>
      if let Some(handler) = &ctx.generic_control_handler {
        handler
          .call2(
            &JsValue::NULL,
            &JsValue::from(*evt.data.get(1).unwrap_or(&0)),
            &JsValue::from(*evt.data.get(2).unwrap_or(&0)),
          )
          .map(|_| ())
      } else {
        debug!(
          "Unhandled MIDI event of type {}, msg={:?}",
          status, evt.data
        );
        Ok(())
      },
  };
  if let Err(err) = res {
    error!("Error executing MIDI event handler callback: {:?}", err);
  }

  std::mem::forget(ctx)
}
