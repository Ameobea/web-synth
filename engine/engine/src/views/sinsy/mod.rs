use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based sample library component.
pub struct Sinsy {
  pub uuid: Uuid,
}

impl Sinsy {
  pub fn new(uuid: Uuid) -> Self { Sinsy { uuid } }
}

impl ViewContext for Sinsy {
  fn init(&mut self) { js::init_sinsy(&self.get_state_key()); }

  fn cleanup(&mut self) { js::cleanup_sinsy(&self.get_state_key()) }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("Sinsy_{}", self.uuid) }

  fn hide(&mut self) { js::hide_sinsy(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_sinsy(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

  fn get_audio_connectables(&self) -> JsValue {
    js::get_sinsy_audio_connectables(self.uuid.to_string().as_str())
  }
}

pub fn mk_sinsy(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(Sinsy { uuid }) }
