use serde_json;
use uuid::Uuid;
use wasm_bindgen::JsValue;

use crate::{js, view_context::ViewContext};

#[derive(Serialize, Deserialize)]
pub struct FilterDesigner {
    pub uuid: Uuid,
}

impl FilterDesigner {
    pub fn new(uuid: Uuid) -> Self { FilterDesigner { uuid } }

    pub fn get_state_key(&self) -> String { format!("filterDesigner_{}", self.uuid) }
}

impl ViewContext for FilterDesigner {
    fn init(&mut self) { js::init_filter_designer(&self.get_state_key()); }

    fn cleanup(&mut self) {
        let state_key = self.get_state_key();
        js::cleanup_filter_designer(&state_key);
    }

    fn get_audio_connectables(&self) -> JsValue {
        js::get_filter_designer_audio_connectables(&self.get_state_key())
    }

    fn get_id(&self) -> String { self.uuid.to_string() }

    fn hide(&mut self) { js::hide_filter_designer(&self.get_state_key()); }

    fn unhide(&mut self) { js::unhide_filter_designer(&self.get_state_key()); }

    fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

    fn save(&mut self) -> String {
        serde_json::to_string(self).expect("Error serializing `FilterDesigner` to String")
    }
}

pub fn mk_filter_designer(definition_opt: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
    let filter_designer: FilterDesigner = match definition_opt {
        Some(definition) =>
            serde_json::from_str(definition).expect("Error while deserializing `FilterDesigner`"),
        None => FilterDesigner::new(uuid),
    };
    box filter_designer
}
