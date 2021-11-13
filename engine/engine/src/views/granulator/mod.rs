use serde_json;
use uuid::Uuid;
use wasm_bindgen::prelude::*;

use crate::{js, view_context::ViewContext};

#[derive(Serialize, Deserialize)]
pub struct Granulator {
    pub uuid: Uuid,
}

impl Granulator {
    pub fn new(uuid: Uuid) -> Self { Granulator { uuid } }

    pub fn get_state_key(&self) -> String { format!("granulator_{}", self.uuid) }
}

impl ViewContext for Granulator {
    fn init(&mut self) { js::init_granulator(&self.get_state_key()); }

    fn cleanup(&mut self) { js::cleanup_granulator(&self.get_state_key()); }

    fn get_id(&self) -> String { self.uuid.to_string() }

    fn hide(&mut self) { js::hide_granulator(&self.get_state_key()); }

    fn unhide(&mut self) { js::unhide_granulator(&self.get_state_key()); }

    fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

    fn save(&mut self) -> String {
        serde_json::to_string(self).expect("Error serializing `Granulator` to String")
    }

    fn get_audio_connectables(&self) -> JsValue {
        js::build_granulator_audio_connectables(&self.get_state_key())
    }

    fn list_used_samples(&self) -> Vec<JsValue> {
        js::granulator_list_used_samples(&self.uuid.to_string())
    }
}

pub fn mk_granulator(definition_opt: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
    let granulator: Granulator = match definition_opt {
        Some(definition) =>
            serde_json::from_str(definition).expect("Error while deserializing `Granulator`"),
        None => Granulator::new(uuid),
    };
    box granulator
}
