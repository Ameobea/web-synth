//! Defines a view that allows connecting between components of an audio composition together

use serde_json;
use uuid::Uuid;

use crate::{helpers::grid::prelude::*, view_context::ViewContext};

/// This is just a shim to the JS-based graph editor.  Since there really aren't any complicated
/// interactive or graphical components of this view context, the actual implementation for this
/// is done in JS.
#[derive(Serialize, Deserialize)]
pub struct GraphEditor {
    pub uuid: Uuid,
}

impl GraphEditor {
    pub fn new(uuid: Uuid) -> Self { GraphEditor { uuid } }

    pub fn get_state_key(&self) -> String { format!("graphEditor_{}", self.uuid) }
}

impl ViewContext for GraphEditor {
    fn init(&mut self) { js::init_graph_editor(&self.get_state_key()); }

    fn cleanup(&mut self) { js::cleanup_graph_editor(&self.get_state_key()); }

    fn get_id(&self) -> String { self.uuid.to_string() }

    fn hide(&mut self) { js::hide_graph_editor(&self.get_id()); }

    fn unhide(&mut self) { js::unhide_graph_editor(&self.get_id()); }

    fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

    fn save(&mut self) -> String {
        serde_json::to_string(self).expect("Error serializing `GraphEditor` to String")
    }
}

pub fn mk_graph_editor(definition_opt: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
    let graph_editor: GraphEditor = match definition_opt {
        Some(definition) =>
            serde_json::from_str(definition).expect("Error while deserializing `GraphEditor`"),
        None => GraphEditor::new(uuid),
    };
    box graph_editor
}
