use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based equalizer component.
pub struct Equalizer {
  pub uuid: Uuid,
}

impl Equalizer {
  pub fn new(uuid: Uuid) -> Self { Equalizer { uuid } }
}

impl ViewContext for Equalizer {
  fn init(&mut self) { js::init_equalizer(&self.get_state_key()); }

  fn persist_state(&self) { js::persist_equalizer(&self.get_state_key()); }

  fn cleanup(&mut self) { js::cleanup_equalizer(&self.get_state_key()) }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("equalizer_{}", self.uuid) }

  fn hide(&mut self) { js::hide_equalizer(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_equalizer(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

  fn get_audio_connectables(&self) -> JsValue {
    js::get_equalizer_audio_connectables(&self.get_state_key())
  }
}

pub fn mk_equalizer(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(Equalizer { uuid }) }
