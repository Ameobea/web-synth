//! Exports functions to JS that handle events including keyup/keydown, mouse clicks, and
//! scroll

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn handle_key_down(key: &str, control_pressed: bool, shift_pressed: bool) {
    // TODO
}

#[allow(clippy::needless_pass_by_value)]
#[wasm_bindgen]
pub fn handle_key_up(key: &str, control_pressed: bool, shift_pressed: bool) {
    // TODO
}

#[wasm_bindgen]
pub fn handle_mouse_down(mut x: usize, y: usize) {
    // TODO
}

#[wasm_bindgen]
pub fn handle_mouse_move(x: usize, y: usize) {
    // TODO
}

#[wasm_bindgen]
pub fn handle_mouse_up(x: usize, _y: usize) {
    // TODO
}

#[wasm_bindgen]
pub fn handle_mouse_wheel(_ydiff: isize) {}
