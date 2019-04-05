pub mod manager;
pub use self::manager::ViewContextManager;

pub trait ViewContext {
    /// Set up the view context to be the primary/active view of the application.  This may involve
    /// things like subscribing to/loading external data sources, creating DOM nodes, etc.
    fn init(&mut self) {}
    /// Clean up any external resources such as DOM elements that were created by the view context,
    /// making the application ready for the creation of a new one.
    fn cleanup(&mut self) {}

    // input handlers
    fn handle_key_down(&mut self, _key: &str, _control_pressed: bool, _shift_pressed: bool) {}
    fn handle_key_up(&mut self, _key: &str, _control_pressed: bool, _shift_pressed: bool) {}
    fn handle_mouse_down(&mut self, _x: usize, _y: usize) {}
    fn handle_mouse_move(&mut self, _x: usize, _y: usize) {}
    fn handle_mouse_up(&mut self, _x: usize, _y: usize) {}
    fn handle_mouse_wheel(&mut self, _ydiff: isize) {}

    fn save(&mut self) -> String;
}
