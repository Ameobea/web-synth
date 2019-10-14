use wasm_bindgen::prelude::*;

pub mod manager;
pub use self::manager::ViewContextManager;

#[wasm_bindgen(raw_module = "./patchNetwork")]
extern "C" {
    fn create_empty_audio_connectables(vc_id: &str) -> JsValue;
}

pub trait ViewContext {
    /// Set up the view context to be the primary/active view of the application.  This may involve
    /// things like subscribing to/loading external data sources, creating DOM nodes, etc.
    fn init(&mut self) {}

    fn get_id(&self) -> String;

    /// Clean up any external resources such as DOM elements that were created by the view context,
    /// making the application ready for the creation of a new one.  This does not mean that the
    /// `ViewContext` is being deleted, merely that it is being "un-rendered."
    fn cleanup(&mut self) {}

    /// This function is called before a `ViewContext` is permanently deleted, meaning that it will
    /// never again be rendered and should dispose of all attached resources and storage.
    fn dispose(&mut self) {}

    /// This is called to indicate that a `ViewContext` should serialize itself into a persistant
    /// format that can be called later to re-create it in its current state from scratch.
    ///
    /// This serialized format should include all settings, configuration, and UI state for the
    /// view context, but it shouldn't include the VC's *data* directly, where data is things like
    /// the content of a text editor or the notes on a grid.  That data should be stored separately
    /// and referenced by a `localStorage` key or something similar.  The reason for this is that
    /// these definitions are created, read, and transferred between WebAssembly and JavaScript
    /// regularly, and storing large data in them will cause that to become slow.
    fn save(&mut self) -> String;

    // input handlers
    fn handle_key_down(&mut self, _key: &str, _control_pressed: bool, _shift_pressed: bool) {}
    fn handle_key_up(&mut self, _key: &str, _control_pressed: bool, _shift_pressed: bool) {}
    fn handle_mouse_down(&mut self, _x: usize, _y: usize) {}
    fn handle_mouse_move(&mut self, _x: usize, _y: usize) {}
    fn handle_mouse_up(&mut self, _x: usize, _y: usize) {}
    fn handle_mouse_wheel(&mut self, _ydiff: isize) {}

    /// A function that will be called with arbitrary messages containing binary data to be handled
    /// in an arbitrary manner by the view context.  Each message includes a type which can be used
    /// to identify it.
    fn handle_message(&mut self, _key: &str, _val: &[u8]) -> Option<Vec<u8>> { None }

    /// Returns a JavaScript object that contains WebAudio constructs that can be used to connect
    /// this `ViewContext` to other `ViewContext`s programatically.  This function should return
    /// the same object throughout the life of the view context.
    fn get_audio_connectables(&self) -> JsValue { create_empty_audio_connectables(&self.get_id()) }
}
