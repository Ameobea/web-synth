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
        dom_id: Option<usize>,
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
    pub fn clear_canvases();

    pub fn init_midi_editor_ui();
    pub fn cleanup_midi_editor_ui();

    pub fn update_active_view_contexts(active_context_ix: usize, view_context_definitions: &str);
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = localStorage)]
    fn getItem(key: &str) -> Option<String>;

    #[wasm_bindgen(js_namespace = localStorage)]
    fn setItem(key: &str, val: &str);

    #[wasm_bindgen(js_namespace = localStorage)]
    fn removeItem(key: &str);

    #[wasm_bindgen(js_namespace = Math)]
    fn random() -> f64;
}

pub fn get_localstorage_key(key: &str) -> Option<String> { getItem(key) }

pub fn set_localstorage_key(key: &str, val: &str) { setItem(key, val); }

pub fn delete_localstorage_key(key: &str) { removeItem(key); }

pub fn js_random() -> f64 { random() }

#[wasm_bindgen(raw_module = "./faustEditor")]
extern "C" {
    pub fn init_faust_editor(state_key: &str);

    pub fn cleanup_faust_editor() -> String;

    pub fn get_faust_editor_content() -> String;
}
