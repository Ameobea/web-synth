use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based component.
pub struct MIDIEditor {
  pub vc_id: Uuid,
}

impl MIDIEditor {
  pub fn new(vc_id: Uuid) -> Self { MIDIEditor { vc_id } }
}

impl ViewContext for MIDIEditor {
  fn init(&mut self) { js::init_midi_editor(&self.vc_id.to_string()); }

  fn cleanup(&mut self) { js::cleanup_midi_editor(&self.vc_id.to_string()) }

  fn get_id(&self) -> String { self.vc_id.to_string() }

  fn get_state_key(&self) -> String { format!("midiEditor_{}", self.vc_id) }

  fn hide(&mut self) { js::hide_midi_editor(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_midi_editor(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

  fn get_audio_connectables(&self) -> JsValue {
    js::get_midi_editor_audio_connectables(self.vc_id.to_string().as_str())
  }
}

pub fn mk_midi_editor(vc_id: Uuid) -> Box<dyn ViewContext> { Box::new(MIDIEditor { vc_id }) }
