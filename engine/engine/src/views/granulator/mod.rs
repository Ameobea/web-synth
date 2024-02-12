use uuid::Uuid;
use wasm_bindgen::prelude::*;

use crate::{js, view_context::ViewContext};

pub struct Granulator {
  pub uuid: Uuid,
}

impl Granulator {
  pub fn new(uuid: Uuid) -> Self { Granulator { uuid } }
}

impl ViewContext for Granulator {
  fn init(&mut self) { js::init_granulator(&self.get_state_key()); }

  fn cleanup(&mut self) { js::cleanup_granulator(&self.get_state_key()); }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("granulator_{}", self.uuid) }

  fn hide(&mut self) { js::hide_granulator(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_granulator(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

  fn get_audio_connectables(&self) -> JsValue {
    js::build_granulator_audio_connectables(&self.get_state_key())
  }

  fn list_used_samples(&self) -> Vec<JsValue> {
    js::granulator_list_used_samples(&self.uuid.to_string())
  }
}

pub fn mk_granulator(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(Granulator::new(uuid)) }
