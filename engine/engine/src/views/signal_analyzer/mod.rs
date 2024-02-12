use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based signal analyzer component.
pub struct SignalAnalyzer {
  pub uuid: Uuid,
}

impl SignalAnalyzer {
  pub fn new(uuid: Uuid) -> Self { SignalAnalyzer { uuid } }
}

impl ViewContext for SignalAnalyzer {
  fn init(&mut self) { js::init_signal_analyzer(&self.get_state_key()); }

  fn cleanup(&mut self) { js::cleanup_signal_analyzer(&self.get_state_key()) }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("SignalAnalyzer_{}", self.uuid) }

  fn hide(&mut self) { js::hide_signal_analyzer(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_signal_analyzer(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

  fn get_audio_connectables(&self) -> JsValue {
    js::get_signal_analyzer_audio_connectables(&self.get_state_key())
  }
}

pub fn mk_signal_analyzer(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(SignalAnalyzer { uuid }) }
