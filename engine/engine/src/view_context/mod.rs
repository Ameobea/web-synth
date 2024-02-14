use downcast_rs::{impl_downcast, Downcast};
use wasm_bindgen::prelude::*;

mod active_view_history;
pub mod manager;

#[wasm_bindgen(raw_module = "./redux/modules/vcmUtils")]
extern "C" {
  pub fn create_empty_audio_connectables(vc_id: &str) -> JsValue;
}

pub trait ViewContext: Downcast {
  /// Set up the view context to be the primary/active view of the application.  This may involve
  /// things like subscribing to/loading external data sources, creating DOM nodes, etc.
  fn init(&mut self) {}

  /// Returns the VC ID as a string.  This should be a UUID.
  fn get_id(&self) -> String;

  /// Returns the `localStorage` key under which this VC's serialized state should be stored.
  fn get_state_key(&self) -> String;

  /// Clean up any external resources such as DOM elements that were created by the view context,
  /// making the application ready for the creation of a new one.  This does not mean that the
  /// `ViewContext` is being deleted, merely that it is being "un-rendered."
  fn cleanup(&mut self) {}

  /// This function is called before a `ViewContext` is permanently deleted, meaning that it will
  /// never again be rendered and should dispose of all attached resources and storage.
  fn dispose(&mut self) {}

  /// Hide the view context, removing any interfaces or UI elements from view.  All functionality
  /// should be preserved, and it should continue operating normally.
  fn hide(&mut self) {}

  /// Unhide the view context, re-creating any UI elements and interfaces to allow the user to
  /// interact with it.
  fn unhide(&mut self) {}

  /// Returns a JavaScript object that contains WebAudio constructs that can be used to connect
  /// this `ViewContext` to other `ViewContext`s programatically.  This function should return
  /// the same object throughout the life of the view context.
  fn get_audio_connectables(&self) -> JsValue { JsValue::null() }

  /// Given the ID of a `<div>` element that exists in the DOM, this VC should render content into
  /// it representing a summary or partial view of its current state along with basic controls for
  /// interacting with it.
  ///
  /// This small view will be rendered into places like modals or sidebars.
  fn render_small_view(&mut self, _target_dom_id: &str) {}

  /// Unrenders whatever was created by `render_small_view` in the `<div>` element with the
  /// provided `id`.
  fn cleanup_small_view(&mut self, _target_dom_id: &str) {}

  /// Return a list of sample descriptors for all samples that are currently in use by this VC.
  /// This should include all samples that are actually being played or that are in some kind of
  /// internal state and can be played depending on some kind of signal or state transition that
  /// doesn't explicitly depend on the user selecting a new sample.
  fn list_used_samples(&self) -> Vec<JsValue> { Vec::new() }
}
impl_downcast!(ViewContext);
