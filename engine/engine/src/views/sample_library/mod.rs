use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based sample library component.
pub struct SampleLibrary {
  pub uuid: Uuid,
}

impl SampleLibrary {
  pub fn new(uuid: Uuid) -> Self { SampleLibrary { uuid } }
}

impl ViewContext for SampleLibrary {
  fn init(&mut self) { js::init_sample_library(&self.get_state_key()); }

  fn cleanup(&mut self) { js::cleanup_sample_library(&self.get_state_key()) }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("SampleLibrary_{}", self.uuid) }

  fn hide(&mut self) { js::hide_sample_library(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_sample_library(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

  fn get_audio_connectables(&self) -> JsValue {
    crate::view_context::create_empty_audio_connectables(self.uuid.to_string().as_str())
  }
}

pub fn mk_sample_library(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(SampleLibrary { uuid }) }
