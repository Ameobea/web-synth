#![feature(thread_local)]
#![allow(clippy::float_cmp, clippy::needless_range_loop, clippy::manual_memcpy)]

extern crate wasm_bindgen;
#[macro_use]
extern crate log;

use std::{ptr, str::FromStr};

use common::uuid_v4;
use js::js_random;
use uuid::Uuid;
use view_context::manager::{ConnectionDescriptor, SerializedSubgraph, ViewContextManager};
use wasm_bindgen::prelude::*;

pub mod js;
pub mod view_context;
pub mod views;
use crate::view_context::manager::{build_view, ForeignConnectable};

/// The global view context manager that holds all of the view contexts for the application.
static mut VIEW_CONTEXT_MANAGER: *mut ViewContextManager = ptr::null_mut();

/// Retrieves the global `ViewContextManager` for the application
pub(crate) fn get_vcm() -> &'static mut ViewContextManager {
  if cfg!(debug_assertions) && unsafe { VIEW_CONTEXT_MANAGER.is_null() } {
    panic!("VIEW_CONTEXT_MANAGER is null");
  }
  unsafe { &mut *VIEW_CONTEXT_MANAGER }
}

/// Entrypoint for the application.  This function is called from the JS side as soon as the Wasm
/// blob is loaded.  It handles setting up application state, rendering the initial UI, and loading
/// the last saved composition from the user.
#[wasm_bindgen]
pub fn init() {
  common::maybe_init(Some(unsafe { std::mem::transmute(js_random()) }));
  wbg_logging::maybe_init();

  // Check if we have an existing VCM and drop it if we do
  if unsafe { !VIEW_CONTEXT_MANAGER.is_null() } {
    let old_vcm = unsafe { Box::from_raw(VIEW_CONTEXT_MANAGER) };
    drop(old_vcm);
  }

  // Create the `ViewContextManager` and initialize it, then set it into the global
  let vcm = Box::new(ViewContextManager::default());
  // We have to store it in the pointer before initializing it since some initializing functions
  // call into JS code which in turn calls back into Rust code which expects to be able to access
  // the global VCM via that pointer.
  unsafe { VIEW_CONTEXT_MANAGER = Box::into_raw(vcm) };
  let mut vcm = unsafe { Box::from_raw(VIEW_CONTEXT_MANAGER) };
  vcm.init();
  unsafe { VIEW_CONTEXT_MANAGER = Box::into_raw(vcm) };
}

/// Creates a new view context from the provided name in the active subgraph and sets it as the main
/// view context for that subgraph.
#[wasm_bindgen]
pub fn create_view_context(vc_name: String, display_name: String) {
  let uuid = uuid_v4();
  debug!("Creating VC with name {} with vcId {}", vc_name, uuid);
  let view_context = build_view(&vc_name, uuid);
  let vcm = get_vcm();
  vcm.add_view_context(uuid, vc_name, view_context, vcm.active_subgraph_id);
  set_vc_title(uuid.to_string(), display_name)
}

#[wasm_bindgen]
pub fn handle_window_close() {
  let vcm = get_vcm();
  for vc_entry in &mut vcm.contexts {
    vc_entry.context.cleanup();
  }
  vcm.save_all();
}

#[wasm_bindgen]
pub fn delete_vc_by_id(id: &str) {
  debug!("delete_vc_by_id(\"{}\")", id);
  let uuid = Uuid::from_str(id).expect("Invalid UUID string passed to `delete_vc_by_id`!");
  get_vcm().delete_vc_by_id(uuid);
}

#[wasm_bindgen]
pub fn swap_vc_positions(ix0: usize, ix1: usize) { get_vcm().swap_vc_positions(ix0, ix1); }

#[wasm_bindgen]
pub fn switch_view_context(uuid_str: &str) {
  let uuid =
    Uuid::from_str(uuid_str).expect("Invalid UUID string passed to `switch_view_context`!");
  get_vcm().set_active_view(uuid, false);
}

#[wasm_bindgen]
pub fn add_subgraph() -> String {
  let vcm = get_vcm();
  let new_subgraph_id = vcm.add_subgraph();
  new_subgraph_id.to_string()
}

#[wasm_bindgen]
pub fn delete_subgraph(subgraph_id: &str) {
  let uuid = Uuid::from_str(subgraph_id).expect("Invalid UUID string passed to `delete_subgraph`!");
  get_vcm().delete_subgraph(uuid);
}

#[wasm_bindgen]
pub fn set_active_subgraph_id(subgraph_id: &str) {
  let uuid =
    Uuid::from_str(subgraph_id).expect("Invalid UUID string passed to `set_active_subgraph_id`!");
  let vcm = get_vcm();
  vcm.set_active_subgraph(uuid, false);
}

#[wasm_bindgen]
pub fn rename_subgraph(subgraph_id: &str, new_name: String) {
  let uuid = Uuid::from_str(subgraph_id).expect("Invalid UUID string passed to `rename_subgraph`!");
  get_vcm().rename_subgraph(uuid, new_name);
}

#[wasm_bindgen]
pub fn serialize_subgraph(subgraph_id: &str, subgraph_name_override: &str) -> String {
  let uuid =
    Uuid::from_str(subgraph_id).expect("Invalid UUID string passed to `serialize_subgraph`");
  let serialized = get_vcm().serialize_subgraph(
    uuid,
    if subgraph_name_override.is_empty() {
      None
    } else {
      Some(subgraph_name_override)
    },
  );
  serde_json::to_string(&serialized).unwrap()
}

#[wasm_bindgen]
pub fn move_vfcs_to_subgraph(vc_ids: &str, subgraph_id: &str) {
  let uuid =
    Uuid::from_str(subgraph_id).expect("Invalid UUID string passed to `move_vcs_to_subgraph`");
  let vc_ids: Vec<String> =
    serde_json::from_str(vc_ids).expect("Invalid JSON passed to `move_vcs_to_subgraph`");
  get_vcm().move_vfcs_to_subgraph(vc_ids, uuid);
}

#[wasm_bindgen]
pub fn load_serialized_subgraph(serialized: &str) -> String {
  let deserialized: SerializedSubgraph =
    serde_json::from_str(serialized).expect("Failed to deserialize provided subgraph JSON");

  get_vcm().load_serialized_subgraph(deserialized).to_string()
}

#[wasm_bindgen]
pub fn undo_view_change() { get_vcm().undo_view_change(); }

#[wasm_bindgen]
pub fn redo_view_change() { get_vcm().redo_view_change(); }

#[wasm_bindgen]
pub fn reset_vcm() {
  info!("Resetting VCM...");
  get_vcm().reset();
  info!(
    "Finished reset; current context count: {}, active_id: {}",
    get_vcm().contexts.len(),
    get_vcm().active_context_id
  );
}

#[wasm_bindgen]
pub fn set_vc_title(uuid_str: String, title: String) {
  let uuid = Uuid::from_str(&uuid_str).expect("Invalid UUID string passed to `set_vc_title`!");
  let vc_entry = get_vcm().get_vc_by_id_mut(uuid).unwrap_or_else(|| {
    panic!(
      "Attempted to set title of VC with ID {} but it wasn't found",
      uuid
    )
  });
  vc_entry.definition.title = Some(title.clone());
  js::set_vc_title(&uuid_str, &title);
}

#[wasm_bindgen]
pub fn get_vc_connectables(vc_id: &str) -> JsValue {
  let uuid = Uuid::from_str(&vc_id).expect("Invalid UUID string passed to `set_vc_title`!");
  let vc_entry = get_vcm().get_vc_by_id(uuid).unwrap_or_else(|| {
    panic!(
      "Attempted to get audio connectables of VC with ID {} but it wasn't found",
      vc_id
    )
  });

  vc_entry.context.get_audio_connectables()
}

#[wasm_bindgen]
pub fn set_connections(connections_json: &str) {
  let connections: Vec<(ConnectionDescriptor, ConnectionDescriptor)> =
    match serde_json::from_str(connections_json) {
      Ok(conns) => conns,
      Err(err) => {
        error!("Failed to deserialize provided connections JSON: {:?}", err);
        return;
      },
    };

  get_vcm().set_connections(connections);
}

#[wasm_bindgen]
pub fn set_foreign_connectables(foreign_connectables_json: &str) {
  let foreign_connectables: Vec<ForeignConnectable> =
    match serde_json::from_str(foreign_connectables_json) {
      Ok(conns) => conns,
      Err(err) => {
        error!(
          "Failed to deserialize provided foreign connectables JSON: {:?}",
          err
        );
        return;
      },
    };

  get_vcm().set_foreign_connectables(foreign_connectables);
}

#[wasm_bindgen]
pub fn render_small_view(vc_id: &str, target_dom_id: &str) {
  let uuid = Uuid::from_str(&vc_id).expect("Invalid UUID string passed to `render_small_view`!");
  let vc_entry = get_vcm().get_vc_by_id_mut(uuid).unwrap_or_else(|| {
    panic!(
      "Attempted to get audio connectables of VC with ID {} but it wasn't found",
      vc_id
    )
  });

  vc_entry.context.render_small_view(target_dom_id);
}

#[wasm_bindgen]
pub fn cleanup_small_view(vc_id: &str, target_dom_id: &str) {
  let uuid = Uuid::from_str(&vc_id).expect("Invalid UUID string passed to `cleanup_small_view`!");
  let vc_entry = get_vcm().get_vc_by_id_mut(uuid).unwrap_or_else(|| {
    panic!(
      "Attempted to get audio connectables of VC with ID {} but it wasn't found",
      vc_id
    )
  });

  vc_entry.context.cleanup_small_view(target_dom_id);
}

/// Returns a list of all samples that are in active use by any VC.  The list is non-deduped and
/// can't be due to limitations of the API's use of `JsValue`.
#[wasm_bindgen]
pub fn get_active_samples() -> Vec<JsValue> {
  let vcm = get_vcm();
  let mut active_samples: Vec<_> = vcm
    .contexts
    .iter()
    .flat_map(|vc| vc.context.list_used_samples().into_iter())
    .collect();

  let foreign_connectables_used_samples = vcm
    .foreign_connectables
    .iter()
    .flat_map(|fc| js::list_foreign_node_used_samples(&fc.id));
  active_samples.extend(foreign_connectables_used_samples);
  active_samples
}
