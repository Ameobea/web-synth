//! Defines a view that allows connecting between components of an audio composition together

use uuid::Uuid;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based graph editor.  Since there really aren't any complicated
/// interactive or graphical components of this view context, the actual implementation for this
/// is done in JS.
pub struct GraphEditor {
  pub uuid: Uuid,
}

impl GraphEditor {
  pub fn new(uuid: Uuid) -> Self { GraphEditor { uuid } }

  pub fn arrange_nodes(&self, node_ids: Option<&[String]>, offset_px: (usize, usize)) {
    let serialized_node_ids = serde_json::to_string(&node_ids).unwrap();
    js::arrange_graph_editor_nodes(
      &self.uuid.to_string(),
      &serialized_node_ids,
      offset_px.0,
      offset_px.1,
    );
  }
}

impl ViewContext for GraphEditor {
  fn init(&mut self) { js::init_graph_editor(&self.get_state_key()); }

  fn cleanup(&mut self) { js::cleanup_graph_editor(&self.get_state_key()); }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("graphEditor_{}", self.uuid) }

  fn hide(&mut self) { js::hide_graph_editor(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_graph_editor(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }
}

pub fn mk_graph_editor(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(GraphEditor::new(uuid)) }
