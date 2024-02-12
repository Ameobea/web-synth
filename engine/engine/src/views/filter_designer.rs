use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

pub struct FilterDesigner {
  pub uuid: Uuid,
}

impl FilterDesigner {
  pub fn new(uuid: Uuid) -> Self { FilterDesigner { uuid } }
}

impl ViewContext for FilterDesigner {
  fn init(&mut self) { js::init_filter_designer(&self.get_state_key()); }

  fn cleanup(&mut self) {
    let state_key = self.get_state_key();
    js::cleanup_filter_designer(&state_key);
  }

  fn get_audio_connectables(&self) -> JsValue {
    js::get_filter_designer_audio_connectables(&self.uuid.to_string())
  }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("filterDesigner_{}", self.uuid) }

  fn hide(&mut self) { js::hide_filter_designer(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_filter_designer(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }
}

pub fn mk_filter_designer(uuid: Uuid) -> Box<dyn ViewContext> {
  Box::new(FilterDesigner::new(uuid))
}
