//! Defines a view that creates an interface for sharing compositions + browsing shared compositions

use uuid::Uuid;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based composition sharing UI.  Since there really aren't any
/// complicated interactive or graphical components of this view context, the actual implementation
/// for this is done in JS.
pub struct CompositionSharing {
  pub uuid: Uuid,
}

impl CompositionSharing {
  pub fn new(uuid: Uuid) -> Self { CompositionSharing { uuid } }
}

impl ViewContext for CompositionSharing {
  fn init(&mut self) { js::init_composition_sharing(&self.get_state_key()); }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("compositionSharing_{}", self.uuid) }

  fn cleanup(&mut self) { js::cleanup_composition_sharing(&self.get_state_key()); }

  fn hide(&mut self) { js::hide_composition_sharing(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_composition_sharing(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }
}

pub fn mk_composition_sharing(uuid: Uuid) -> Box<dyn ViewContext> {
  Box::new(CompositionSharing::new(uuid))
}
