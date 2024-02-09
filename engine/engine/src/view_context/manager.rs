use std::str::FromStr;

use common::uuid_v4;
use fxhash::FxHashMap;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
  js,
  views::{
    composition_sharing::mk_composition_sharing, control_panel::mk_control_panel,
    faust_editor::mk_faust_editor, filter_designer::mk_filter_designer, granulator::mk_granulator,
    graph_editor::mk_graph_editor, looper::mk_looper, midi_editor::mk_midi_editor,
    midi_keyboard::mk_midi_keyboard, sample_library::mk_sample_library, sampler::mk_sampler,
    sequencer::mk_sequencer, signal_analyzer::mk_signal_analyzer, sinsy::mk_sinsy,
    synth_designer::mk_synth_designer, welcome_page::mk_welcome_page,
  },
};

use super::{
  active_view_history::{ActiveView, ActiveViewHistory},
  ViewContext,
};

/// The `localstorage` key under which the serialized state of the VCM is stored.  This is loaded
/// when the application initializes, and it is periodically updated with a fresh value as the
/// application is updated.
///
/// It doesn't actually contain the data for the individual view contexts, but rather it contains
/// the `localStorage` keys at which they can be retrieved.  This allows individual VCs to be
/// updated without having to re-serialize all of the others as well.
pub const VCM_STATE_KEY: &str = "vcmState";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinimalViewContextDefinition {
  pub name: String,
  pub uuid: String,
  pub title: Option<String>,
  #[serde(default = "Uuid::nil", rename = "subgraphId")]
  pub subgraph_id: Uuid,
}

pub struct ViewContextEntry {
  pub id: Uuid,
  pub definition: MinimalViewContextDefinition,
  pub context: Box<dyn ViewContext>,
  /// A flag indicating if this entry has received any actions since it was last saved
  pub touched: bool,
}

impl ::std::fmt::Debug for ViewContextEntry {
  fn fmt(&self, f: &mut ::std::fmt::Formatter) -> ::std::fmt::Result {
    f.debug_struct("ViewContextEntry")
      .field("definition", &self.definition)
      .field("context", &"<opaque>")
      .field("touched", &self.touched)
      .finish()
  }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ForeignConnectable {
  #[serde(rename = "type")]
  pub _type: String,
  pub id: String,
  #[serde(default = "Uuid::nil", rename = "subgraphId")]
  pub subgraph_id: Uuid,
  #[serde(rename = "serializedState")]
  pub serialized_state: Option<serde_json::Value>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SubgraphDescriptor {
  pub id: Uuid,
  pub name: String,
  #[serde(rename = "activeVcId")]
  pub active_vc_id: Uuid,
}

pub(crate) struct ViewContextManager {
  pub active_context_id: Uuid,
  pub contexts: Vec<ViewContextEntry>,
  pub connections: Vec<(ConnectionDescriptor, ConnectionDescriptor)>,
  pub foreign_connectables: Vec<ForeignConnectable>,
  pub subgraphs_by_id: FxHashMap<Uuid, SubgraphDescriptor>,
  /// Nil UUID corresponds to the root graph
  pub active_subgraph_id: Uuid,
  pub active_view_history: ActiveViewHistory,
}

impl Default for ViewContextManager {
  fn default() -> Self {
    ViewContextManager {
      active_context_id: Uuid::nil(),
      contexts: Vec::new(),
      connections: Vec::new(),
      foreign_connectables: Vec::new(),
      subgraphs_by_id: Default::default(),
      active_subgraph_id: Uuid::nil(),
      active_view_history: ActiveViewHistory::default(),
    }
  }
}

#[derive(Serialize, Deserialize)]
pub struct ViewContextDefinition {
  pub minimal_def: MinimalViewContextDefinition,
}

/// Represents a connection between two `ViewContext`s.  It holds the ID of the src and dst VC along
/// with the name of the input and output that are connected.
#[derive(Clone, Serialize, Deserialize)]
pub struct ConnectionDescriptor {
  #[serde(rename = "vcId")]
  pub vc_id: String,
  pub name: String,
}

/// Represents the state of the application in a form that can be serialized and deserialized into
/// the browser's `localStorage` to refresh the state from scratch when the application reloads.
#[derive(Serialize, Deserialize)]
struct ViewContextManagerState {
  /// This contains the IDs of all managed VCs.  The actual `ViewContextDefinition`s for each of
  /// them are found in separate `localStorage` entries.
  pub view_context_ids: Vec<String>,
  #[serde(rename = "active_view_ix")]
  pub deprecated_active_view_ix: usize,
  #[serde(default = "Uuid::nil")]
  pub active_view_id: Uuid,
  pub patch_network_connections: Vec<(ConnectionDescriptor, ConnectionDescriptor)>,
  pub foreign_connectables: Vec<ForeignConnectable>,
  #[serde(default)]
  pub subgraphs_by_id: FxHashMap<Uuid, SubgraphDescriptor>,
  /// Nil UUID corresponds to the root graph
  #[serde(default = "Uuid::nil")]
  pub active_subgraph_id: Uuid,
  #[serde(default)]
  pub active_view_history: ActiveViewHistory,
}

fn get_vc_key(uuid: Uuid) -> String { format!("vc_{}", uuid) }

impl ViewContextManager {
  /// Adds a `ViewContext` instance to be managed by the `ViewContextManager`.  Returns its index.
  fn add_view_context_inner(
    &mut self,
    definition: MinimalViewContextDefinition,
    view_context: Box<dyn ViewContext>,
  ) -> usize {
    self.contexts.push(ViewContextEntry {
      id: Uuid::from_str(&definition.uuid).expect("Invalid UUID in `ViewContextEntry`"),
      definition,
      context: view_context,
      touched: false,
    });

    self.contexts.len() - 1
  }

  /// Adds a `ViewContext` instance to be managed by the `ViewContextManager`.  Returns its index.
  pub fn add_view_context(
    &mut self,
    uuid: Uuid,
    name: String,
    mut view_context: Box<dyn ViewContext>,
    subgraph_id: Uuid,
  ) -> usize {
    view_context.init();
    view_context.hide();

    let created_ix = self.add_view_context_inner(
      MinimalViewContextDefinition {
        uuid: uuid.to_string(),
        name: name.clone(),
        title: None,
        subgraph_id,
      },
      view_context,
    );

    js::add_view_context(&uuid.to_string(), &name, &subgraph_id.to_string());

    self.save_all();
    created_ix
  }

  /// This triggers a fresh FC to get created on the frontend along with its associated node.
  ///
  /// The frontend will then commit the FCs back here
  fn add_foreign_connectable(&mut self, fc: ForeignConnectable) {
    js::add_foreign_connectable(&serde_json::to_string(&fc).unwrap());
  }

  pub fn get_vc_by_id_mut(&mut self, uuid: Uuid) -> Option<&mut ViewContextEntry> {
    self
      .get_vc_position(uuid)
      .map(move |ix| &mut self.contexts[ix])
  }

  pub fn get_vc_by_id(&self, uuid: Uuid) -> Option<&ViewContextEntry> {
    self.get_vc_position(uuid).map(move |ix| &self.contexts[ix])
  }

  fn init_from_state_snapshot(&mut self, vcm_state: ViewContextManagerState) {
    for vc_id in vcm_state.view_context_ids {
      let definition_str = match js::get_localstorage_key(&format!("vc_{}", vc_id)) {
        Some(definition) => definition,
        None => {
          error!(
            "Attempted to look up VC `localStorage` entry \"{}\" listed in {} but it wasn't found.",
            vc_id, VCM_STATE_KEY
          );
          continue;
        },
      };
      let definition: ViewContextDefinition = match serde_json::from_str(&definition_str) {
        Ok(definition) => definition,
        Err(err) => {
          error!("Error deserializing `ViewContextDefinition`: {:?}", err);
          continue;
        },
      };

      let mut view_context = build_view(
        &definition.minimal_def.name,
        Uuid::from_str(&definition.minimal_def.uuid).unwrap(),
      );

      view_context.init();
      view_context.hide();

      self.add_view_context_inner(definition.minimal_def, view_context);
    }

    if !vcm_state.active_view_id.is_nil() {
      self.active_context_id = vcm_state.active_view_id;
    } else {
      self.active_context_id = self
        .contexts
        .get(vcm_state.deprecated_active_view_ix)
        .map(|vc| vc.id)
        .unwrap_or_else(Uuid::nil);
    }
    self.connections = vcm_state.patch_network_connections;
    self.foreign_connectables = vcm_state.foreign_connectables;

    self.active_subgraph_id = vcm_state.active_subgraph_id;
    self.subgraphs_by_id = vcm_state.subgraphs_by_id;
    if self.subgraphs_by_id.is_empty() {
      self
        .subgraphs_by_id
        .insert(Uuid::nil(), SubgraphDescriptor {
          id: Uuid::nil(),
          name: "Root".to_string(),
          active_vc_id: self.active_context_id,
        });
    }

    self.active_view_history = vcm_state.active_view_history;
    if !self.active_context_id.is_nil() && self.active_view_history.history.is_empty() {
      self
        .active_view_history
        .set_active_view(self.active_subgraph_id, self.active_context_id);
    }
  }

  fn load_vcm_state() -> Option<ViewContextManagerState> {
    let vcm_state_str_opt = js::get_localstorage_key(VCM_STATE_KEY);
    vcm_state_str_opt.and_then(|vcm_state_str| match serde_json::from_str(&vcm_state_str) {
      Ok(vcm_state) => Some(vcm_state),
      Err(err) => {
        error!("Error deserializing stored VCM state: {:?}", err);
        None
      },
    })
  }

  /// Loads saved application state from the browser's `localstorage`.  Then calls the `init()`
  /// function of all managed `ViewContext`s.
  pub fn init(&mut self) {
    if let Some(vcm_state) = Self::load_vcm_state() {
      self.init_from_state_snapshot(vcm_state);
    } else {
      panic!("No VCM state found in localStorage; must have been set by this point");
    };

    if self.contexts.is_empty() {
      self.reset();
    }

    if !self
      .contexts
      .iter()
      .any(|vc| vc.id == self.active_context_id)
    {
      self.active_context_id = self.contexts[0].id;
    }

    self.get_active_view_mut().unhide();

    self.init_vcs();
  }

  /// Retrieves the active `ViewContextManager`
  pub fn get_active_view_mut(&mut self) -> &mut dyn ViewContext {
    let active_vc_id = self.active_context_id;
    self
      .contexts
      .iter_mut()
      .find(|vc| vc.id == active_vc_id)
      .unwrap_or_else(|| {
        panic!(
          "Tried to get active VC with ID {} but it wasn't found",
          active_vc_id
        )
      })
      .context
      .as_mut()
  }

  /// Updates the UI with an up-to-date listing of active view contexts and persist the current
  /// VCM state to `localStorage`.
  pub fn init_vcs(&mut self) {
    let minimal_view_context_definitions: Vec<MinimalViewContextDefinition> = self
      .contexts
      .iter()
      .map(|vc_entry| vc_entry.definition.clone())
      .collect();
    let definitions_str = serde_json::to_string(&minimal_view_context_definitions).unwrap();
    let connections_json = serde_json::to_string(&self.connections).unwrap();
    let foreign_connectables_json = serde_json::to_string(&self.foreign_connectables).unwrap();

    js::init_view_contexts(
      &self.active_context_id.to_string(),
      &definitions_str,
      &connections_json,
      &foreign_connectables_json,
      &self.active_subgraph_id.to_string(),
      serde_json::to_string(&self.subgraphs_by_id)
        .unwrap()
        .as_str(),
    );

    self.save_all()
  }

  /// Creates a new subgraph that contains a graph editor as its single view context
  pub fn add_subgraph(&mut self) -> Uuid {
    let new_subgraph_id = uuid_v4();

    let new_graph_editor_vc_id = uuid_v4();
    self
      .subgraphs_by_id
      .insert(new_subgraph_id, SubgraphDescriptor {
        id: new_subgraph_id,
        name: "Subgraph".to_owned(),
        active_vc_id: new_graph_editor_vc_id,
      });
    js::set_subgraphs(
      &self.active_subgraph_id.to_string(),
      &serde_json::to_string(&self.subgraphs_by_id).unwrap(),
    );

    // Start out the new subgraph with a graph editor
    self.add_view_context(
      new_graph_editor_vc_id,
      "graph_editor".to_string(),
      mk_graph_editor(new_graph_editor_vc_id),
      new_subgraph_id,
    );

    // Add ssubgraph portals to and from the subgraph so the user can navigate between them
    self.add_foreign_connectable(ForeignConnectable {
      _type: "customAudio/subgraphPortal".to_owned(),
      id: String::new(),
      serialized_state: Some(
        json!({ "txSubgraphID": self.active_subgraph_id, "rxSubgraphID": new_subgraph_id }),
      ),
      subgraph_id: self.active_subgraph_id,
    });
    self.add_foreign_connectable(ForeignConnectable {
      _type: "customAudio/subgraphPortal".to_owned(),
      id: String::new(),
      serialized_state: Some(
        json!({ "txSubgraphID": new_subgraph_id, "rxSubgraphID": self.active_subgraph_id }),
      ),
      subgraph_id: new_subgraph_id,
    });

    new_subgraph_id
  }

  pub fn delete_subgraph(&mut self, subgraph_id: Uuid) {
    self
      .active_view_history
      .filter(|active_view| active_view.subgraph_id != subgraph_id);

    todo!();
  }

  pub fn set_active_subgraph(&mut self, subgraph_id: Uuid, skip_history: bool) {
    if self.active_subgraph_id == subgraph_id {
      return;
    }

    // Hide all VCs from the old subgraph
    for vc in self.contexts.iter_mut() {
      if vc.definition.subgraph_id == self.active_subgraph_id {
        vc.context.hide();
      }
    }

    self
      .subgraphs_by_id
      .get_mut(&self.active_subgraph_id)
      .unwrap()
      .active_vc_id = self.active_context_id;
    self.active_subgraph_id = subgraph_id;
    self.set_active_view(self.subgraphs_by_id[&subgraph_id].active_vc_id, true);
    if !skip_history {
      self
        .active_view_history
        .set_active_view(self.active_subgraph_id, self.active_context_id);
    }

    self.save_all();
    js::set_subgraphs(
      &self.active_subgraph_id.to_string(),
      &serde_json::to_string(&self.subgraphs_by_id).unwrap(),
    );
  }

  fn set_view(&mut self, subgraph_id: Uuid, vc_id: Uuid) -> Result<(), ()> {
    if self.subgraphs_by_id.contains_key(&subgraph_id)
      && self.contexts.iter().any(|vc| vc.id == vc_id)
    {
      self.set_active_subgraph(subgraph_id, true);
      self.set_active_view(vc_id, true);
      Ok(())
    } else {
      Err(())
    }
  }

  pub fn undo_view_change(&mut self) {
    loop {
      match self.active_view_history.undo() {
        Some(ActiveView { subgraph_id, vc_id }) => {
          if self.set_view(subgraph_id, vc_id).is_ok() {
          } else {
            self
              .active_view_history
              .clear(self.active_subgraph_id, self.active_context_id);
          }
          break;
        },
        None => break,
      }
    }
  }

  pub fn redo_view_change(&mut self) {
    loop {
      match self.active_view_history.redo() {
        Some(ActiveView { subgraph_id, vc_id }) => {
          if self.set_view(subgraph_id, vc_id).is_ok() {
          } else {
            self
              .active_view_history
              .clear(self.active_subgraph_id, self.active_context_id);
          }
          break;
        },
        None => break,
      }
    }
  }

  pub fn get_vc_position(&self, id: Uuid) -> Option<usize> {
    self.contexts.iter().position(|vc_entry| vc_entry.id == id)
  }

  /// Removes the view context with the supplied ID, calling its `.cleanup()` function, deleting
  /// its `localStorage` key, and updating the root `localStorage` key to no longer list it.
  pub fn delete_vc_by_id(&mut self, id: Uuid) {
    let ix = match self.get_vc_position(id) {
      Some(ix) => ix,
      None => {
        error!("Tried to delete a VC with ID {} but it wasn't found.", id);
        return;
      },
    };

    let old_active_vc_id = self.active_context_id;
    let old_active_vc_ix = self
      .contexts
      .iter()
      .filter(|vc| vc.definition.subgraph_id == self.active_subgraph_id)
      .position(|vc| vc.id == self.active_context_id);

    let mut vc_entry = self.contexts.remove(ix);
    // Unrender it
    vc_entry.context.cleanup();
    // And clean up any of its attached resources of storage assets
    vc_entry.context.dispose();
    // Finally delete the VC entry for the VC itself
    js::delete_localstorage_key(&get_vc_key(id));

    // If the deleted VC was the active VC, pick the one that's not at its old index to be active
    if self.active_context_id == id {
      match self
        .contexts
        .iter_mut()
        .filter(|vc| vc.definition.subgraph_id == self.active_subgraph_id)
        .nth(old_active_vc_ix.unwrap_or(0))
      {
        Some(vc) => {
          self.active_context_id = vc.id;
          vc.context.unhide();
        },
        None => match self
          .contexts
          .iter_mut()
          .filter(|vc| vc.definition.subgraph_id == self.active_subgraph_id)
          .last()
        {
          Some(vc) => {
            self.active_context_id = vc.id;
            vc.context.unhide();
          },
          None => {
            self.active_context_id = Uuid::nil();
          },
        },
      }
    }

    self
      .active_view_history
      .filter(|active_view| active_view.vc_id != id);

    js::delete_view_context(&id.to_string());
    if self.active_context_id != old_active_vc_id {
      js::set_active_vc_id(&self.active_context_id.to_string());
    }

    self.save_all();
  }

  fn serialize(&self) -> ViewContextManagerState {
    // TODO: Actually make use of the `touched` flag optimization here.
    let mut view_context_definitions = Vec::new();
    let mut view_context_ids = Vec::new();

    for entry in &self.contexts {
      view_context_ids.push(entry.definition.uuid.clone());
      let vc_id = entry.id;
      let view_context_definition: ViewContextDefinition = ViewContextDefinition {
        minimal_def: entry.definition.clone(),
      };
      js::set_localstorage_key(
        &get_vc_key(vc_id),
        &serde_json::to_string(&view_context_definition).unwrap(),
      );
      view_context_definitions.push(view_context_definition);
    }

    let mut subgraphs_by_id = self.subgraphs_by_id.clone();
    if let Some(subgraph_def) = subgraphs_by_id.get_mut(&self.active_subgraph_id) {
      if !self.subgraphs_by_id.contains_key(&self.active_subgraph_id) {
        error!(
          "Tried to serialize VCM with active subgraphId={} but it wasn't found",
          self.active_subgraph_id
        );
      }

      subgraph_def.active_vc_id = self.active_context_id;
    }

    ViewContextManagerState {
      view_context_ids,
      deprecated_active_view_ix: 0,
      active_view_id: self.active_context_id,
      patch_network_connections: self.connections.clone(),
      foreign_connectables: self.foreign_connectables.clone(),
      subgraphs_by_id,
      active_subgraph_id: self.active_subgraph_id,
      active_view_history: self.active_view_history.clone(),
    }
  }

  /// Serializes all managed view contexts (and recursively those of all subgraphs) and saves them
  /// to persistent storage.
  ///
  /// TODO: Periodically call this, probably from inside of the VCMs themselves, in order to keep
  /// the state up to date.
  pub fn save_all(&mut self) {
    let state = self.serialize();

    let serialized_state: String = serde_json::to_string(&state).unwrap();

    js::set_localstorage_key(VCM_STATE_KEY, &serialized_state);
  }

  pub fn set_active_view(&mut self, view_id: Uuid, skip_history: bool) {
    self.save_all();
    self.get_active_view_mut().hide();
    self.active_context_id = view_id;
    match self.subgraphs_by_id.get_mut(&self.active_subgraph_id) {
      Some(subgraph) => subgraph.active_vc_id = view_id,
      None => {
        error!(
          "Tried to set active view to vcId={view_id} but there's no subgraphId={}",
          self.active_subgraph_id
        );
      },
    }
    if !skip_history {
      self
        .active_view_history
        .set_active_view(self.active_subgraph_id, view_id);
    }
    self.get_active_view_mut().unhide();
    js::set_active_vc_id(&view_id.to_string());
  }

  pub fn set_connections(
    &mut self,
    new_connections: Vec<(ConnectionDescriptor, ConnectionDescriptor)>,
  ) {
    self.connections = new_connections;
    self.save_all();
    // We don't commit since all connection state lives on the frontend.  This is because
    // connections intimitely deal with WebAudio nodes, and there's not really anything we
    // can do with them here in Rust right now.
    //
    // We just read the connections out of JSON, send them to the frontend where they're
    // deserialized and connected, and leave it at that.
  }

  pub fn set_foreign_connectables(&mut self, new_foreign_connectables: Vec<ForeignConnectable>) {
    self.foreign_connectables = new_foreign_connectables;
    self.save_all();
    // Don't commit for the same reason as in `set_connections`
  }

  /// Resets the VCM to its initial state, deleting all existing VCs.
  pub fn reset(&mut self) {
    // Delete + dispose all stored VCs
    let contexts_to_delete: Vec<Uuid> = self.contexts.iter().map(|entry| entry.id).collect();
    for uuid in contexts_to_delete {
      self.delete_vc_by_id(uuid);
    }

    // Delete the VCM root state key itself
    js::delete_localstorage_key(VCM_STATE_KEY);

    // Re-initialize from scratch
    self.contexts.clear();
    self.connections.clear();
    self.foreign_connectables.clear();

    js::initialize_default_vcm_state();
  }
}

pub fn build_view(name: &str, uuid: Uuid) -> Box<dyn ViewContext> {
  match name {
    "midi_editor" => mk_midi_editor(uuid),
    "faust_editor" => mk_faust_editor(uuid),
    "graph_editor" => mk_graph_editor(uuid),
    "composition_sharing" => mk_composition_sharing(uuid),
    "synth_designer" => mk_synth_designer(uuid),
    "midi_keyboard" => mk_midi_keyboard(uuid),
    "sequencer" => mk_sequencer(uuid),
    "sample_library" => mk_sample_library(uuid),
    "control_panel" => mk_control_panel(uuid),
    "granulator" => mk_granulator(uuid),
    "filter_designer" => mk_filter_designer(uuid),
    "sinsy" => mk_sinsy(uuid),
    "looper" => mk_looper(uuid),
    "welcome_page" => mk_welcome_page(uuid),
    "signal_analyzer" => mk_signal_analyzer(uuid),
    "sampler" => mk_sampler(uuid),
    _ => panic!("No handler for view context with name {}", name),
  }
}
