use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based sampler component.
pub struct Sampler {
  pub uuid: Uuid,
}

impl Sampler {
  pub fn new(uuid: Uuid) -> Self { Sampler { uuid } }
}

impl ViewContext for Sampler {
  fn init(&mut self) { js::init_sampler(&self.get_state_key()); }

  fn cleanup(&mut self) { js::cleanup_sampler(&self.get_state_key()) }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("sampler_{}", self.uuid) }

  fn hide(&mut self) { js::hide_sampler(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_sampler(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

  fn get_audio_connectables(&self) -> JsValue {
    js::get_sampler_audio_connectables(&self.get_state_key())
  }
}

pub fn mk_sampler(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(Sampler { uuid }) }
