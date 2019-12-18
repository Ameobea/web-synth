//! Re-exports external functions exported by JS

use wasm_bindgen::prelude::*;

#[wasm_bindgen(raw_module = "./index")]
extern "C" {
    pub fn init_view_contexts(
        active_context_ix: usize,
        view_context_definitions: &str,
        connections_json: &str,
        foreign_connectables_json: &str,
    );
    pub fn add_view_context(id: &str, name: &str);
    pub fn delete_view_context(id: &str);
    pub fn set_active_vc_ix(new_ix: usize);
}

#[wasm_bindgen(raw_module = "./grid")]
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

    pub fn init_grid(vc_id: &str);
    pub fn cleanup_grid(vc_id: &str);
    pub fn hide_grid(vc_id: &str);
    pub fn unhide_grid(vc_id: &str);
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
    pub fn hide_faust_editor(vc_id: &str);
    pub fn unhide_faust_editor(vc_id: &str);
    pub fn cleanup_faust_editor(vc_id: &str);
    pub fn get_faust_editor_content(vc_id: &str) -> String;
    pub fn get_faust_editor_connectables(vc_id: &str) -> JsValue;
    pub fn render_faust_editor_small_view(vc_id: &str, target_dom_id: &str);
    pub fn cleanup_faust_editor_small_view(vc_id: &str, target_dom_id: &str);
}

#[wasm_bindgen(raw_module = "./graphEditor")]
extern "C" {
    pub fn init_graph_editor(state_key: &str);
    pub fn hide_graph_editor(vc_id: &str);
    pub fn unhide_graph_editor(vc_id: &str);
    pub fn cleanup_graph_editor(state_key: &str);
}

#[wasm_bindgen(raw_module = "./midiEditor")]
extern "C" {
    pub fn hide_midi_editor(vc_id: &str);
    pub fn unhide_midi_editor(vc_id: &str);
    pub fn create_midi_editor_audio_connectables(id: &str) -> JsValue;

    pub fn init_midi_editor_ui(vc_id: &str);
    pub fn cleanup_midi_editor_ui(vc_id: &str);
}

#[wasm_bindgen(raw_module = "./compositionSharing")]
extern "C" {
    pub fn init_composition_sharing(state_key: &str);
    pub fn hide_composition_sharing(vc_id: &str);
    pub fn unhide_composition_sharing(vc_id: &str);
    pub fn cleanup_composition_sharing();
}

#[wasm_bindgen(raw_module = "./synthDesigner")]
extern "C" {
    pub fn init_synth_designer(state_key: &str);
    pub fn hide_synth_designer(vc_id: &str);
    pub fn unhide_synth_designer(vc_id: &str);
    pub fn cleanup_synth_designer(state_key: &str) -> String;
    pub fn get_synth_designer_audio_connectables(state_key: &str) -> JsValue;
}

#[wasm_bindgen(raw_module = "./midiKeyboard")]
extern "C" {
    pub fn init_midi_keyboard(state_key: &str);
    pub fn hide_midi_keyboard(state_key: &str);
    pub fn unhide_midi_keyboard(state_key: &str);
    pub fn cleanup_midi_keyboard(state_key: &str) -> String;
    pub fn get_midi_keyboard_audio_connectables(state_key: &str) -> JsValue;
}

#[wasm_bindgen(raw_module = "./sequencer")]
extern "C" {
    pub fn init_sequencer(state_key: &str);
    pub fn cleanup_sequencer(state_key: &str);
    pub fn hide_sequencer(state_key: &str);
    pub fn unhide_sequencer(state_key: &str);
    pub fn get_sequencer_audio_connectables(state_key: &str) -> JsValue;
}
