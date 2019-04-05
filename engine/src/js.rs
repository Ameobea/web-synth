//! Re-exports external functions exported by JS

use wasm_bindgen::prelude::*;

#[wasm_bindgen(raw_module = "./index")]
extern "C" {
    pub fn render_quad(
        canvas_index: usize,
        x: usize,
        y: usize,
        width: usize,
        height: usize,
        class: &str,
    ) -> usize;
    pub fn render_line(
        canvas_index: usize,
        x1: usize,
        y1: usize,
        x2: usize,
        y2: usize,
        class: &str,
    ) -> usize;
    pub fn get_active_attr(key: &str) -> Option<String>;
    pub fn set_active_attr(key: &str, val: &str);
    pub fn set_attr(id: usize, key: &str, val: &str);
    pub fn get_attr(id: usize, key: &str) -> Option<String>;
    pub fn del_attr(id: usize, key: &str);
    pub fn add_class(id: usize, className: &str);
    pub fn remove_class(id: usize, className: &str);
    pub fn delete_element(id: usize);
    pub fn save_composition(base64: &str);
    pub fn load_composition() -> Option<String>;

    pub fn init_midi_editor_ui();
    pub fn cleanup_midi_editor_ui();
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = localStorage)]
    fn getItem(key: &str) -> Option<String>;

    #[wasm_bindgen(js_namespace = localStorage)]
    fn setItem(key: &str, val: &str);
}

#[wasm_bindgen(raw_module = "./faustEditor")]
extern "C" {
    pub fn init_faust_editor(editor_text: &str);

    pub fn cleanup_faust_editor();
}

pub fn get_localstorage_key(key: &str) -> Option<String> { getItem(key) }

pub fn set_localstorage_key(key: &str, val: &str) { setItem(key, val); }
