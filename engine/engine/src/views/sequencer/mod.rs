use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based sequencer component.
pub struct Sequencer {
  pub uuid: Uuid,
}

impl Sequencer {
  pub fn new(uuid: Uuid) -> Self { Sequencer { uuid } }
}

impl ViewContext for Sequencer {
  fn init(&mut self) { js::init_sequencer(&self.get_state_key()); }

  fn cleanup(&mut self) { js::cleanup_sequencer(&self.get_state_key()); }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("sequencer_{}", self.uuid) }

  fn hide(&mut self) { js::hide_sequencer(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_sequencer(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

  fn get_audio_connectables(&self) -> JsValue {
    js::get_sequencer_audio_connectables(&self.get_id())
  }

  fn render_small_view(&mut self, target_dom_id: &str) {
    js::render_sequencer_small_view(&self.get_id(), target_dom_id);
  }

  fn cleanup_small_view(&mut self, target_dom_id: &str) {
    js::cleanup_sequencer_small_view(&self.get_id(), target_dom_id);
  }

  fn list_used_samples(&self) -> Vec<JsValue> {
    js::sequencer_list_used_samples(&self.get_state_key())
  }
}

pub fn mk_sequencer(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(Sequencer { uuid }) }
