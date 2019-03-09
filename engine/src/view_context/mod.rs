pub mod manager;
pub use self::manager::ViewContextManager;

pub trait ViewContext {
    fn init(&mut self);
    fn cleanup(&mut self);

    // input handlers
    fn handle_key_down(&mut self, key: &str, control_pressed: bool, shift_pressed: bool);
    fn handle_key_up(&mut self, key: &str, control_pressed: bool, shift_pressed: bool);
    fn handle_mouse_down(&mut self, x: usize, y: usize);
    fn handle_mouse_move(&mut self, x: usize, y: usize);
    fn handle_mouse_up(&mut self, x: usize, y: usize);
    fn handle_mouse_wheel(&mut self, ydiff: isize);

    // serialization + deserialization
    fn load(&mut self, serialized: &str);
    fn save(&self) -> String;
}
