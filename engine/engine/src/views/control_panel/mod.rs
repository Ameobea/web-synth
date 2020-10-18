use serde_json;
use uuid::Uuid;

use crate::{helpers::grid::prelude::*, view_context::ViewContext};

#[derive(Serialize, Deserialize)]
pub struct ControlPanel {
    pub uuid: Uuid,
}

impl ControlPanel {
    pub fn new(uuid: Uuid) -> Self { ControlPanel { uuid } }

    pub fn get_state_key(&self) -> String { format!("controlPanel_{}", self.uuid) }
}

impl ViewContext for ControlPanel {
    fn init(&mut self) { js::init_control_panel(&self.get_state_key()); }

    fn cleanup(&mut self) { js::cleanup_control_panel(&self.get_state_key()); }

    fn get_id(&self) -> String { self.uuid.to_string() }

    fn hide(&mut self) { js::hide_control_panel(&self.get_state_key()); }

    fn unhide(&mut self) { js::unhide_control_panel(&self.get_state_key()); }

    fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

    fn save(&mut self) -> String {
        serde_json::to_string(self).expect("Error serializing `ControlPanel` to String")
    }

    fn get_audio_connectables(&self) -> JsValue {
        js::get_control_panel_audio_connectables(&self.get_state_key())
    }
}

pub fn mk_control_panel(definition_opt: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
    let control_panel: ControlPanel = match definition_opt {
        Some(definition) =>
            serde_json::from_str(definition).expect("Error while deserializing `ControlPanel`"),
        None => ControlPanel::new(uuid),
    };
    box control_panel
}
