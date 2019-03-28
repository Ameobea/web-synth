//! Exports functions to JS that handle events including keyup/keydown, mouse clicks, and
//! scroll

use wasm_bindgen::prelude::*;

use crate::get_vcm;

#[wasm_bindgen]
pub fn handle_key_down(key: &str, control_pressed: bool, shift_pressed: bool) {
    get_vcm()
        .get_active_view_mut()
        .handle_key_down(key, control_pressed, shift_pressed);
}

#[allow(clippy::needless_pass_by_value)]
#[wasm_bindgen]
pub fn handle_key_up(key: &str, control_pressed: bool, shift_pressed: bool) {
    get_vcm()
        .get_active_view_mut()
        .handle_key_up(key, control_pressed, shift_pressed);
}

#[wasm_bindgen]
pub fn handle_mouse_down(x: usize, y: usize) {
    get_vcm().get_active_view_mut().handle_mouse_down(x, y);
}

#[wasm_bindgen]
pub fn handle_mouse_move(x: usize, y: usize) {
    get_vcm().get_active_view_mut().handle_mouse_move(x, y);
}

#[wasm_bindgen]
pub fn handle_mouse_up(x: usize, y: usize) {
    get_vcm().get_active_view_mut().handle_mouse_up(x, y);
}

#[wasm_bindgen]
pub fn handle_mouse_wheel(ydiff: isize) {
    get_vcm().get_active_view_mut().handle_mouse_wheel(ydiff);
}
