use uuid::Uuid;

use crate::{helpers::grid::prelude::*, view_context::ViewContext};

/// This is just a shim to the JS-based MIDI keyboard component.  It maps keypresses on the normal
/// keyboard to MIDI events that are routable in the patch network.
pub struct MIDIKeyboard {
    pub uuid: Uuid,
}

impl MIDIKeyboard {
    pub fn new(uuid: Uuid) -> Self { MIDIKeyboard { uuid } }

    pub fn get_state_key(&self) -> String { format!("MIDIKeyboard_{}", self.uuid) }
}

impl ViewContext for MIDIKeyboard {
    fn init(&mut self) { js::init_midi_keyboard(&self.get_state_key()); }

    fn cleanup(&mut self) { js::cleanup_midi_keyboard(&self.get_state_key()); }

    fn get_id(&self) -> String { self.uuid.to_string() }

    fn hide(&mut self) { js::hide_midi_keyboard(&self.get_state_key()); }

    fn unhide(&mut self) { js::unhide_midi_keyboard(&self.get_state_key()); }

    fn get_audio_connectables(&self) -> JsValue {js::get_midi_keyboard_audio_connectables(&self.get_state_key())}
}

pub fn mk_midi_keyboard(_definition_opt: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
    Box::new(MIDIKeyboard { uuid })
}
