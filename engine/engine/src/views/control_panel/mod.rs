use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

pub struct ControlPanel {
  pub uuid: Uuid,
}

impl ControlPanel {
  pub fn new(uuid: Uuid) -> Self { ControlPanel { uuid } }
}

impl ViewContext for ControlPanel {
  fn init(&mut self) { js::init_control_panel(&self.get_state_key()); }

  fn cleanup(&mut self) { js::cleanup_control_panel(&self.get_state_key()); }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("controlPanel_{}", self.uuid) }

  fn hide(&mut self) { js::hide_control_panel(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_control_panel(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

  fn get_audio_connectables(&self) -> JsValue {
    js::get_control_panel_audio_connectables(&self.get_state_key())
  }
}

pub fn mk_control_panel(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(ControlPanel::new(uuid)) }
