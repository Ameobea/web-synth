//! Defines a view that allows creating and customizing a synthesizer

use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based synth designer.  Since there really aren't any complicated
/// interactive or graphical components of this view context, the actual implementation for this
/// is done in JS.
pub struct SynthDesigner {
  pub uuid: Uuid,
}

impl SynthDesigner {
  pub fn new(uuid: Uuid) -> Self { SynthDesigner { uuid } }
}

impl ViewContext for SynthDesigner {
  fn init(&mut self) { js::init_synth_designer(&self.get_state_key()); }

  fn cleanup(&mut self) {
    let state_key = self.get_state_key();
    let serialized_state = js::cleanup_synth_designer(&state_key);
    js::set_localstorage_key(&state_key, &serialized_state)
  }

  fn get_audio_connectables(&self) -> JsValue {
    js::get_synth_designer_audio_connectables(&self.get_state_key())
  }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("synthDesigner_{}", self.uuid) }

  fn hide(&mut self) { js::hide_synth_designer(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_synth_designer(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }
}

pub fn mk_synth_designer(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(SynthDesigner::new(uuid)) }
