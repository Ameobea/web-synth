use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based MIDI keyboard component.  It maps keypresses on the normal
/// keyboard to MIDI events that are routable in the patch network.
pub struct MIDIKeyboard {
  pub uuid: Uuid,
}

impl MIDIKeyboard {
  pub fn new(uuid: Uuid) -> Self { MIDIKeyboard { uuid } }
}

impl ViewContext for MIDIKeyboard {
  fn init(&mut self) { js::init_midi_keyboard(&self.get_state_key()); }

  fn cleanup(&mut self) {
    let state = js::cleanup_midi_keyboard(&self.get_state_key());
    js::set_localstorage_key(&self.get_state_key(), &state);
  }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("MIDIKeyboard_{}", self.uuid) }

  fn hide(&mut self) { js::hide_midi_keyboard(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_midi_keyboard(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

  fn get_audio_connectables(&self) -> JsValue {
    js::get_midi_keyboard_audio_connectables(&self.get_state_key())
  }

  fn render_small_view(&mut self, target_dom_id: &str) {
    js::render_midi_keyboard_small_view(&self.get_state_key(), target_dom_id);
  }

  fn cleanup_small_view(&mut self, target_dom_id: &str) {
    js::cleanup_midi_keyboard_small_view(&self.get_id(), target_dom_id);
  }
}

pub fn mk_midi_keyboard(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(MIDIKeyboard { uuid }) }
