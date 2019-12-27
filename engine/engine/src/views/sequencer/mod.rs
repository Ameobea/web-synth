use uuid::Uuid;

use crate::{helpers::grid::prelude::*, view_context::ViewContext};

/// This is just a shim to the JS-based sequencer component.
pub struct Sequencer {
    pub uuid: Uuid,
}

impl Sequencer {
    pub fn new(uuid: Uuid) -> Self { Sequencer { uuid } }

    pub fn get_state_key(&self) -> String { format!("sequencer_{}", self.uuid) }
}

impl ViewContext for Sequencer {
    fn init(&mut self) { js::init_sequencer(&self.get_state_key()); }

    fn cleanup(&mut self) { js::cleanup_sequencer(&self.get_state_key()); }

    fn get_id(&self) -> String { self.uuid.to_string() }

    fn hide(&mut self) { js::hide_sequencer(&self.get_state_key()); }

    fn unhide(&mut self) { js::unhide_sequencer(&self.get_state_key()); }

    fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

    fn get_audio_connectables(&self) -> JsValue {
        js::get_sequencer_audio_connectables(&self.get_id())
    }
}

pub fn mk_sequencer(_definition_opt: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
    Box::new(Sequencer { uuid })
}
