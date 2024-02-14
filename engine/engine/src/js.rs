//! Re-exports external functions exported by JS

use wasm_bindgen::prelude::*;

#[wasm_bindgen(raw_module = "./vcInterop")]
extern "C" {
  pub fn init_view_contexts(
    active_context_id: &str,
    view_context_definitions: &str,
    connections_json: &str,
    foreign_connectables_json: &str,
    active_subgraph_id: &str,
    subgraphs_by_id_json: &str,
  );
  pub fn add_view_context(id: &str, name: &str, subgraph_id: &str);
  pub fn add_foreign_connectable(fc_json: &str) -> String;
  pub fn add_connection(from_vc_id: &str, from_port_name: &str, to_vc_id: &str, to_port_name: &str);
  pub fn delete_connection(
    from_vc_id: &str,
    from_port_name: &str,
    to_vc_id: &str,
    to_port_name: &str,
  );
  pub fn set_connections(connections_json: &str);
  pub fn set_foreign_connectables(foreign_connectables_json: &str);
  pub fn set_view_contexts(active_vc_id: &str, view_context_minimal_defs_json: &str);
  pub fn delete_foreign_connectable(id: &str);
  pub fn delete_view_context(id: &str);
  pub fn set_active_vc_id(new_id: &str);
  pub fn set_subgraphs(active_subgraph_id: &str, subgraphs_by_id_json: &str);
  pub fn set_vc_title(uuid_str: &str, title: &str);
  pub fn list_foreign_node_used_samples(id: &str) -> Vec<JsValue>;
  /// Returns the ID of the active view context to display after initializing
  pub fn initialize_default_vcm_state();
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
  pub fn hide_graph_editor(state_key: &str);
  pub fn unhide_graph_editor(state_key: &str);
  pub fn cleanup_graph_editor(state_key: &str);
  pub fn arrange_graph_editor_nodes(vc_id: &str, node_ids: &str, offset_x: usize, offset_y: usize);
}

#[wasm_bindgen(raw_module = "./midiEditor")]
extern "C" {
  pub fn hide_midi_editor(state_key: &str);
  pub fn unhide_midi_editor(state_key: &str);
  pub fn init_midi_editor(vc_id: &str);
  pub fn cleanup_midi_editor(vc_id: &str);
  pub fn get_midi_editor_audio_connectables(vc_id: &str) -> JsValue;
}

#[wasm_bindgen(raw_module = "./compositionSharing")]
extern "C" {
  pub fn init_composition_sharing(state_key: &str);
  pub fn hide_composition_sharing(state_key: &str);
  pub fn unhide_composition_sharing(state_key: &str);
  pub fn cleanup_composition_sharing(state_key: &str);
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
  pub fn render_midi_keyboard_small_view(state_key: &str, target_dom_id: &str);
  pub fn cleanup_midi_keyboard_small_view(vc_id: &str, target_dom_id: &str);
}

#[wasm_bindgen(raw_module = "./sequencer")]
extern "C" {
  pub fn init_sequencer(state_key: &str);
  pub fn cleanup_sequencer(state_key: &str);
  pub fn hide_sequencer(state_key: &str);
  pub fn unhide_sequencer(state_key: &str);
  pub fn get_sequencer_audio_connectables(state_key: &str) -> JsValue;
  pub fn render_sequencer_small_view(vc_id: &str, target_dom_id: &str);
  pub fn cleanup_sequencer_small_view(vc_id: &str, target_dom_id: &str);
  pub fn sequencer_list_used_samples(state_key: &str) -> Vec<JsValue>;
}

#[wasm_bindgen(raw_module = "./sampleLibrary")]
extern "C" {
  pub fn init_sample_library(state_key: &str);
  pub fn cleanup_sample_library(state_key: &str);
  pub fn hide_sample_library(state_key: &str);
  pub fn unhide_sample_library(state_key: &str);
}

#[wasm_bindgen(raw_module = "./controlPanel")]
extern "C" {
  pub fn init_control_panel(state_key: &str);
  pub fn cleanup_control_panel(state_key: &str);
  pub fn hide_control_panel(state_key: &str);
  pub fn unhide_control_panel(state_key: &str);
  pub fn get_control_panel_audio_connectables(state_key: &str) -> JsValue;
}

#[wasm_bindgen(raw_module = "./granulator")]
extern "C" {
  pub fn init_granulator(state_key: &str);
  pub fn cleanup_granulator(state_key: &str);
  pub fn hide_granulator(state_key: &str);
  pub fn unhide_granulator(state_key: &str);
  pub fn build_granulator_audio_connectables(state_key: &str) -> JsValue;
  pub fn granulator_list_used_samples(vc_id: &str) -> Vec<JsValue>;
}

#[wasm_bindgen(raw_module = "./filterDesigner")]
extern "C" {
  pub fn init_filter_designer(state_key: &str);
  pub fn hide_filter_designer(vc_id: &str);
  pub fn unhide_filter_designer(vc_id: &str);
  pub fn cleanup_filter_designer(state_key: &str);
  pub fn get_filter_designer_audio_connectables(vc_id: &str) -> JsValue;
}

#[wasm_bindgen(raw_module = "./vocalSynthesis/sinsyViewContext")]
extern "C" {
  pub fn init_sinsy(state_key: &str);
  pub fn hide_sinsy(vc_id: &str);
  pub fn unhide_sinsy(vc_id: &str);
  pub fn cleanup_sinsy(state_key: &str);
  pub fn get_sinsy_audio_connectables(vc_id: &str) -> JsValue;
}

#[wasm_bindgen(raw_module = "./looper/Looper")]
extern "C" {
  pub fn init_looper(state_key: &str);
  pub fn hide_looper(vc_id: &str);
  pub fn unhide_looper(vc_id: &str);
  pub fn cleanup_looper(state_key: &str);
  pub fn get_looper_audio_connectables(vc_id: &str) -> JsValue;
}

#[wasm_bindgen(raw_module = "./welcomePage/WelcomePage")]
extern "C" {
  pub fn init_welcome_page(state_key: &str);
  pub fn hide_welcome_page(state_key: &str);
  pub fn unhide_welcome_page(state_key: &str);
  pub fn cleanup_welcome_page(state_key: &str);
}

#[wasm_bindgen(raw_module = "./signalAnalyzer/signalAnalyzer")]
extern "C" {
  pub fn init_signal_analyzer(state_key: &str);
  pub fn hide_signal_analyzer(state_key: &str);
  pub fn unhide_signal_analyzer(state_key: &str);
  pub fn cleanup_signal_analyzer(state_key: &str);
  pub fn get_signal_analyzer_audio_connectables(state_key: &str) -> JsValue;
}

#[wasm_bindgen(raw_module = "./sampler/sampler")]
extern "C" {
  pub fn init_sampler(state_key: &str);
  pub fn hide_sampler(state_key: &str);
  pub fn unhide_sampler(state_key: &str);
  pub fn cleanup_sampler(state_key: &str);
  pub fn get_sampler_audio_connectables(state_key: &str) -> JsValue;
}
