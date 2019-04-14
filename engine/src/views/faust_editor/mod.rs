//! Defines a view that creates a text editor and controls for compiling and running Faust scripts.

use serde_json;
use uuid::Uuid;

use crate::{helpers::grid::prelude::*, view_context::ViewContext};

/// This is just a shim to the JS-based Faust editor.  Since there really aren't any complicated
/// interactive or graphical components of this view context, the actual implementation for this
/// is done in JS.
#[derive(Serialize, Deserialize)]
pub struct FaustEditor {
    pub uuid: Uuid,
}

impl FaustEditor {
    pub fn new(uuid: Uuid) -> Self { FaustEditor { uuid } }

    pub fn get_state_key(&self) -> String { format!("faustEditor_{}", self.uuid) }
}

impl ViewContext for FaustEditor {
    fn init(&mut self) { js::init_faust_editor(&self.get_state_key()); }

    fn cleanup(&mut self) {
        let faust_editor_content = js::cleanup_faust_editor();
        js::set_localstorage_key(&self.get_state_key(), &faust_editor_content)
    }

    fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

    fn save(&mut self) -> String {
        serde_json::to_string(self).expect("Error serializing `FaustEditor` to String")
    }
}

pub fn mk_faust_editor(definition_opt: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
    let faust_editor: FaustEditor = match definition_opt {
        Some(definition) =>
            serde_json::from_str(definition).expect("Error while deserializing `FaustEditor`"),
        None => FaustEditor::new(uuid),
    };
    box faust_editor
}
