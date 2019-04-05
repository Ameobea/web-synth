//! Defines a view that creates a text editor and controls for compiling and running Faust scripts.

use serde_json;

use crate::{helpers::grid::prelude::*, view_context::ViewContext};

/// This is just a shim to the JS-based Faust editor.  Since there really aren't any complicated
/// interactive or graphical components of this view context, the actual implementation for this
/// is done in JS.
#[derive(Serialize, Deserialize)]
pub struct FaustEditor {
    pub editor_text: String,
}

impl ViewContext for FaustEditor {
    fn init(&mut self) { js::init_faust_editor(&self.editor_text); }

    fn cleanup(&mut self) { js::cleanup_faust_editor(); }

    fn save(&self) -> String {
        serde_json::to_string(self).expect("Error while serializing `FaustEditor`")
    }
}

pub fn mk_faust_editor(definition: &str) -> Box<dyn ViewContext> {
    let faust_editor: FaustEditor =
        serde_json::from_str(definition).expect("Error while deserializing `FaustEditor`");
    box faust_editor
}
