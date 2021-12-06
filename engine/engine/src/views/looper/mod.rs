use serde_json;
use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

#[derive(Serialize, Deserialize)]
pub struct Looper {
    pub uuid: Uuid,
}

impl Looper {
    pub fn new(uuid: Uuid) -> Self { Looper { uuid } }

    pub fn get_state_key(&self) -> String { format!("looper_{}", self.uuid) }
}

impl ViewContext for Looper {
    fn init(&mut self) { js::init_looper(&self.get_state_key()); }

    fn cleanup(&mut self) {
        let state_key = self.get_state_key();
        js::cleanup_looper(&state_key);
    }

    fn get_audio_connectables(&self) -> JsValue {
        js::get_looper_audio_connectables(&self.uuid.to_string())
    }

    fn get_id(&self) -> String { self.uuid.to_string() }

    fn hide(&mut self) { js::hide_looper(&self.get_state_key()); }

    fn unhide(&mut self) { js::unhide_looper(&self.get_state_key()); }

    fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

    fn save(&mut self) -> String {
        serde_json::to_string(self).expect("Error serializing `Looper` to String")
    }
}

pub fn mk_looper(definition_opt: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
    let looper: Looper = match definition_opt {
        Some(definition) =>
            serde_json::from_str(definition).expect("Error while deserializing `Looper`"),
        None => Looper::new(uuid),
    };
    box looper
}
