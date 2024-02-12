use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

pub struct Looper {
  pub uuid: Uuid,
}

impl Looper {
  pub fn new(uuid: Uuid) -> Self { Looper { uuid } }
}

impl ViewContext for Looper {
  fn init(&mut self) { js::init_looper(&self.get_state_key()); }

  fn cleanup(&mut self) {
    let state_key = self.get_state_key();
    js::cleanup_looper(&state_key);
  }

  fn get_audio_connectables(&self) -> JsValue {
    js::get_looper_audio_connectables(&self.uuid.to_string())
  }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("looper_{}", self.uuid) }

  fn hide(&mut self) { js::hide_looper(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_looper(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }
}

pub fn mk_looper(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(Looper::new(uuid)) }
