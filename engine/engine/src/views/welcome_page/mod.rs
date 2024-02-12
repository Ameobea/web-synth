use uuid::Uuid;

use crate::{js, view_context::ViewContext};

/// This is just a shim to the JS-based composition sharing UI.  Since there really aren't any
/// complicated interactive or graphical components of this view context, the actual implementation
/// for this is done in JS.
pub struct WelcomePage {
  pub uuid: Uuid,
}

impl WelcomePage {
  pub fn new(uuid: Uuid) -> Self { WelcomePage { uuid } }
}

impl ViewContext for WelcomePage {
  fn init(&mut self) { js::init_welcome_page(&self.get_state_key()); }

  fn get_id(&self) -> String { self.uuid.to_string() }

  fn get_state_key(&self) -> String { format!("welcomePage_{}", self.uuid) }

  fn cleanup(&mut self) { js::cleanup_welcome_page(&self.get_state_key()); }

  fn hide(&mut self) { js::hide_welcome_page(&self.get_state_key()); }

  fn unhide(&mut self) { js::unhide_welcome_page(&self.get_state_key()); }

  fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }
}

pub fn mk_welcome_page(uuid: Uuid) -> Box<dyn ViewContext> { Box::new(WelcomePage::new(uuid)) }
