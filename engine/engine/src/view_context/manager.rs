use std::str::FromStr;

use common::uuid_v4;
use fxhash::{FxHashMap, FxHashSet};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
  js,
  views::{
    composition_sharing::mk_composition_sharing,
    control_panel::mk_control_panel,
    faust_editor::mk_faust_editor,
    filter_designer::mk_filter_designer,
    granulator::mk_granulator,
    graph_editor::{mk_graph_editor, GraphEditor},
    looper::mk_looper,
    midi_editor::mk_midi_editor,
    midi_keyboard::mk_midi_keyboard,
    sample_library::mk_sample_library,
    sampler::mk_sampler,
    sequencer::mk_sequencer,
    signal_analyzer::mk_signal_analyzer,
    sinsy::mk_sinsy,
    synth_designer::mk_synth_designer,
    welcome_page::mk_welcome_page,
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
  pub uuid: Uuid,
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
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
  pub view_context_ids: Vec<Uuid>,
  /// This was used previously to identify which VC was active.  Now that subgraphs exist, this is
  /// only used as backwards compatibility to deal with old saved states.
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

#[derive(Debug)]
struct SubgraphConn {
  pub tx: Uuid,
  pub rx: Uuid,
  pub portal_id: String,
}

#[derive(Serialize, Deserialize)]
pub struct SerializedVCD {
  pub def: MinimalViewContextDefinition,
  pub localstorage_val: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct SerializedSubgraph {
  pub fcs: Vec<ForeignConnectable>,
  pub vcs: Vec<SerializedVCD>,
  pub intra_conns: Vec<(ConnectionDescriptor, ConnectionDescriptor)>,
  pub subgraphs: Vec<(Uuid, SubgraphDescriptor)>,
  pub base_subgraph_id: Uuid,
  /// ID of the subgraph which links to the subgraph being serialized
  pub connnecting_subgraph_id: Option<Uuid>,
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
      id: definition.uuid,
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
        uuid,
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
    self.contexts.iter_mut().find(|vc| vc.id == uuid)
  }

  pub fn get_vc_by_id(&self, uuid: Uuid) -> Option<&ViewContextEntry> {
    self.contexts.iter().find(|vc| vc.id == uuid)
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

      let mut view_context = build_view(&definition.minimal_def.name, definition.minimal_def.uuid);

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

  fn add_subgraph_portal(
    &mut self,
    tx_subgraph_id: Uuid,
    rx_subgraph_id: Uuid,
    inputs: Option<serde_json::Value>,
    outputs: Option<serde_json::Value>,
  ) {
    let mut serialized_state =
      json!({ "txSubgraphID": tx_subgraph_id, "rxSubgraphID": rx_subgraph_id });
    if let Some(inputs) = inputs {
      serialized_state["registeredInputs"] = inputs;
    }
    if let Some(outputs) = outputs {
      serialized_state["registeredOutputs"] = outputs;
    }

    self.add_foreign_connectable(ForeignConnectable {
      _type: "customAudio/subgraphPortal".to_owned(),
      id: String::new(),
      serialized_state: Some(serialized_state),
      subgraph_id: tx_subgraph_id,
    });
  }

  fn add_bidirectional_subgraph_portal(&mut self, tx_subgraph_id: Uuid, rx_subgraph_id: Uuid) {
    self.add_subgraph_portal(tx_subgraph_id, rx_subgraph_id, None, None);
    self.add_subgraph_portal(rx_subgraph_id, tx_subgraph_id, None, None);
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

    // Add subgraph portals to and from the subgraph so the user can navigate between them
    self.add_bidirectional_subgraph_portal(new_subgraph_id, self.active_subgraph_id);

    new_subgraph_id
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

  pub fn rename_subgraph(&mut self, subgraph_id: Uuid, new_name: String) {
    let subgraph = self
      .subgraphs_by_id
      .get_mut(&subgraph_id)
      .expect("Tried to rename a subgraph that doesn't exist.  This should never happen.");
    subgraph.name = new_name;
    js::set_subgraphs(
      &self.active_subgraph_id.to_string(),
      &serde_json::to_string(&self.subgraphs_by_id).unwrap(),
    );
  }

  /// Using subgraph portals, creates an edge list of all connections between subgraphs in the VCM.
  ///
  /// Since all subgraph portals are bidirectional, this returns both the forward and reverse
  /// connections.
  fn get_all_subgraph_conns(&self) -> Vec<SubgraphConn> {
    let mut all_subgraph_connections: Vec<SubgraphConn> = Vec::new();
    for fc in &self.foreign_connectables {
      if fc._type == "customAudio/subgraphPortal" {
        let serialized_state = fc.serialized_state.as_ref().unwrap();
        let tx_subgraph_id = Uuid::from_str(
          serialized_state["txSubgraphID"]
            .as_str()
            .expect("txSubgraphID was not a string"),
        )
        .expect("txSubgraphID was not a valid UUID");
        let rx_subgraph_id = Uuid::from_str(
          serialized_state["rxSubgraphID"]
            .as_str()
            .expect("rxSubgraphID was not a string"),
        )
        .expect("rxSubgraphID was not a valid UUID");
        all_subgraph_connections.push(SubgraphConn {
          tx: tx_subgraph_id,
          rx: rx_subgraph_id,
          portal_id: fc.id.clone(),
        });
      }
    }

    all_subgraph_connections
  }

  /// Returns `(all_subgraph_connections, child_subgraphs)`, where `all_subgraph_connections` is
  /// a list of all subgraph portals in the VCM, and `child_subgraphs` is a list of all subgraphs
  /// that are children of the subgraph with the specified ID - including the subgraph itself.
  fn get_child_subgraph_ids(
    &self,
    target_subgraph_id: Uuid,
  ) -> (Vec<SubgraphConn>, FxHashSet<Uuid>) {
    if target_subgraph_id.is_nil() {
      panic!("This function doesn't work for getting the children of the root subgraph");
    }

    // First, we determine the hierarchy of all subgraphs based on the subgraph portals
    let all_subgraph_connections = self.get_all_subgraph_conns();

    // Now, we need to find all subgraphs that are children of the target subgraph
    //
    // However, there's a complication.  All subgraph portals are bidirectional.  We only want to
    // delete subgraphs that are children of the target subgraph, not siblings or parents.
    //
    // To achieve this, we first do a BFS starting from the root subgraph to identify all subgraphs
    // that are above the target subgraph.
    //
    // Then, we do a BFS starting from the target subgraph to identify all subgraphs that are below
    // it.
    let mut excluded_subgraphs: FxHashSet<Uuid> = FxHashSet::default();
    excluded_subgraphs.insert(Uuid::nil());
    let mut child_subgraphs: FxHashSet<Uuid> = FxHashSet::default();
    let mut queue: Vec<Uuid> = vec![Uuid::nil()];
    while !queue.is_empty() {
      let subgraph_id = queue.pop().unwrap();

      let conns_from_subgraph = all_subgraph_connections
        .iter()
        .filter(|conn| conn.tx == subgraph_id);

      for conn in conns_from_subgraph {
        if conn.rx == subgraph_id {
          error!(
            "Subgraph portal with tx=rx={:?} is a self-loop",
            subgraph_id
          );
          continue;
        } else if conn.rx == target_subgraph_id {
          continue;
        }

        let is_new = excluded_subgraphs.insert(conn.rx);
        if is_new {
          queue.push(conn.rx);
        }
      }
    }

    child_subgraphs.insert(target_subgraph_id);
    queue.push(target_subgraph_id);
    while !queue.is_empty() {
      let subgraph_id = queue.pop().unwrap();
      for conn in &all_subgraph_connections {
        if conn.tx == subgraph_id {
          if child_subgraphs.contains(&conn.rx) || excluded_subgraphs.contains(&conn.rx) {
            continue;
          }

          child_subgraphs.insert(conn.rx);
          queue.push(conn.rx);
        }
      }
    }

    (all_subgraph_connections, child_subgraphs)
  }

  /// Recursively deletes the specified subgraph, all VCs and foreign connectables within it, and
  /// all child subgraphs as determined by subgraph portals.
  pub fn delete_subgraph(&mut self, subgraph_id_to_delete: Uuid) {
    let (all_subgraph_connections, subgraphs_to_delete) =
      self.get_child_subgraph_ids(subgraph_id_to_delete);

    // Find all VCs and FCs that are in the subgraphs we're deleting
    let vcs_to_delete: Vec<Uuid> = self
      .contexts
      .iter()
      .filter(|vc| subgraphs_to_delete.contains(&vc.definition.subgraph_id))
      .map(|vc| vc.id)
      .collect();
    let mut fc_ids_to_delete: Vec<String> = self
      .foreign_connectables
      .iter()
      .filter(|fc| subgraphs_to_delete.contains(&fc.subgraph_id))
      .map(|fc| fc.id.clone())
      .collect();

    // Also delete all subgraph portals that point to any of the deleted subgraphs
    for conn in &all_subgraph_connections {
      if subgraphs_to_delete.contains(&conn.tx) || subgraphs_to_delete.contains(&conn.rx) {
        fc_ids_to_delete.push(conn.portal_id.clone());
      }
    }
    fc_ids_to_delete.sort_unstable();
    fc_ids_to_delete.dedup();

    // Delete all VCs and FCs that are in the subgraphs we're deleting
    info!(
      "About to delete {} VCs and {} FCs while deleting subgraph id={subgraph_id_to_delete}",
      vcs_to_delete.len(),
      fc_ids_to_delete.len(),
    );
    for vc_id in &vcs_to_delete {
      self.delete_vc_by_id(*vc_id);
    }
    for fc_id in &fc_ids_to_delete {
      self.delete_foreign_connectable_by_id(fc_id);
    }

    // Finally, delete the subgraphs themselves
    for subgraph_id in &subgraphs_to_delete {
      self.subgraphs_by_id.remove(&subgraph_id);
      if self.active_subgraph_id == *subgraph_id {
        self.active_subgraph_id = Uuid::nil();
      }
    }
    info!(
      "Deleted subgraph id={} along with {} other child subgraph(s)",
      subgraph_id_to_delete,
      subgraphs_to_delete.len() - 1
    );

    // Update view history to remove entries referencing deleted subgraphs or VCs
    self.active_view_history.filter(|active_view| {
      subgraphs_to_delete.contains(&active_view.subgraph_id)
        || vcs_to_delete.contains(&active_view.vc_id)
    });

    // Save the updated state
    js::set_subgraphs(
      &self.active_subgraph_id.to_string(),
      &serde_json::to_string(&self.subgraphs_by_id).unwrap(),
    );
    self.save_all();
  }

  /// Returns the subgraph ID of the provided VC or FC id
  fn get_subgraph_id(&self, vc_id: &str) -> Option<Uuid> {
    self
      .foreign_connectables
      .iter()
      .find_map(|fc| {
        if fc.id == *vc_id {
          Some(fc.subgraph_id)
        } else {
          None
        }
      })
      .or_else(|| {
        self.contexts.iter().find_map(|vc| {
          if vc.id.to_string() == *vc_id {
            Some(vc.definition.subgraph_id)
          } else {
            None
          }
        })
      })
  }

  /// Assumes all frontend state has been committed to the backend already (`onBeforeUnload()`)
  pub fn serialize_subgraph(
    &self,
    subgraph_id: Uuid,
    subgraph_name_override: Option<&str>,
  ) -> SerializedSubgraph {
    let included_subgraph_ids = if subgraph_id.is_nil() {
      self.subgraphs_by_id.keys().cloned().collect()
    } else {
      let (_all_subgraph_connections, included_subgraph_ids) =
        self.get_child_subgraph_ids(subgraph_id);
      included_subgraph_ids
    };

    let fcs = self
      .foreign_connectables
      .iter()
      .filter(|fc| included_subgraph_ids.contains(&fc.subgraph_id))
      .cloned()
      .collect::<Vec<ForeignConnectable>>();
    let vcs = self
      .contexts
      .iter()
      .filter(|vc| included_subgraph_ids.contains(&vc.definition.subgraph_id))
      .map(|vc| {
        let state_key = vc.context.get_state_key();
        let state = js::get_localstorage_key(&state_key);

        SerializedVCD {
          def: vc.definition.clone(),
          localstorage_val: state,
        }
      })
      .collect::<Vec<SerializedVCD>>();
    // Connections that are fully within the subgraph and its children, so will be included in the
    // serialized state
    let intra_conns = self
      .connections
      .iter()
      .filter(|(src, dst)| {
        let Some(tx_subgraph_id) = self.get_subgraph_id(&src.vc_id) else {
          error!("Couldn't find subgraph ID for VC ID {}", src.vc_id);
          return false;
        };
        if !included_subgraph_ids.contains(&tx_subgraph_id) {
          return false;
        };
        let Some(rx_subgraph_id) = self.get_subgraph_id(&dst.vc_id) else {
          error!("Couldn't find subgraph ID for VC ID {}", dst.vc_id);
          return false;
        };
        if !included_subgraph_ids.contains(&rx_subgraph_id) {
          return false;
        };

        true
      })
      .cloned()
      .collect::<Vec<_>>();
    let subgraphs = self
      .subgraphs_by_id
      .iter()
      .filter(|(id, _)| included_subgraph_ids.contains(id))
      .map(|(id, desc)| {
        let mut desc = desc.clone();
        if let Some(name_override) = subgraph_name_override {
          if desc.id == subgraph_id {
            desc.name = name_override.to_owned();
          }
        }
        (*id, desc)
      })
      .collect::<Vec<_>>();

    SerializedSubgraph {
      fcs,
      vcs,
      intra_conns,
      subgraphs,
      base_subgraph_id: subgraph_id,
      connnecting_subgraph_id: if subgraph_id.is_nil() {
        None
      } else {
        Some(self.active_subgraph_id)
      },
    }
  }

  /// Given a `SerializedSubgraph` containing the state for a subgraph any 0 or more child
  /// subgraphs, creates all entities (VCs, FCs, and subgraphs) and connections in the VCM.
  ///
  /// Handles generating new random IDs for all entities to avoid conflicts when loading the same
  /// saved subgraph multiple times.
  ///
  /// Creates subgraph portals between the current active subgraph and the new subgraph.
  ///
  /// Returns the ID of the new subgraph.
  pub fn load_serialized_subgraph(&mut self, mut serialized: SerializedSubgraph) -> Uuid {
    let mut new_uuid_by_old_uuid = FxHashMap::default();
    let mut new_sid_by_old_sid = FxHashMap::default();

    for (id, desc) in &mut serialized.subgraphs {
      let new_id = uuid_v4();
      new_uuid_by_old_uuid.insert(*id, new_id);
      self.subgraphs_by_id.insert(new_id, desc.clone());
      desc.id = new_id;
      *id = new_id;
    }
    serialized.base_subgraph_id = new_uuid_by_old_uuid[&serialized.base_subgraph_id];
    js::set_subgraphs(
      &self.active_subgraph_id.to_string(),
      &serde_json::to_string(&self.subgraphs_by_id).unwrap(),
    );

    #[derive(Clone, Serialize, Deserialize)]
    struct SerializedSubgraphState {
      #[serde(rename = "txSubgraphID")]
      tx_subgraph_id: Uuid,
      #[serde(rename = "rxSubgraphID")]
      rx_subgraph_id: Uuid,
      #[serde(rename = "registeredInputs")]
      registered_inputs: Option<serde_json::Value>,
      #[serde(rename = "registeredOutputs")]
      registered_outputs: Option<serde_json::Value>,
    }

    let mut base_portal_state = None;
    for fc in &mut serialized.fcs {
      fc.subgraph_id = new_uuid_by_old_uuid[&fc.subgraph_id];

      // If this is a subgraph portal linking to the connecting subgraph, we need to re-point it to
      // link with the current active subgraph instead
      if fc._type == "customAudio/subgraphPortal" {
        let Some(state) = fc.serialized_state.clone() else {
          error!(
            "Mising/invalid serialized state for subgraph portal FC {:?}",
            fc
          );
          continue;
        };
        let Ok(mut state) = serde_json::from_value::<SerializedSubgraphState>(state) else {
          error!("Error deserializing subgraph portal state for FC {:?}", fc);
          continue;
        };

        let mapped_tx_subgraph_id = new_uuid_by_old_uuid[&state.tx_subgraph_id];
        info!(
          "Re-pointing subgraph portal tx. Old ID: {}, new ID: {}",
          state.tx_subgraph_id, mapped_tx_subgraph_id
        );
        state.tx_subgraph_id = mapped_tx_subgraph_id;

        if fc.subgraph_id == serialized.base_subgraph_id
          && mapped_tx_subgraph_id == serialized.base_subgraph_id
          && Some(state.rx_subgraph_id) == serialized.connnecting_subgraph_id
        {
          info!(
            "Re-pointing subgraph portal rx to active subgraph.  Old ID: {}, new ID: {}",
            state.rx_subgraph_id, self.active_subgraph_id
          );
          state.rx_subgraph_id = self.active_subgraph_id;

          if base_portal_state.is_some() {
            error!("Found more than one subgraph portal linking to the connecting subgraph");
          }
          base_portal_state = Some(state.clone());
        } else {
          state.rx_subgraph_id = new_uuid_by_old_uuid[&state.rx_subgraph_id];
        }

        fc.serialized_state = Some(serde_json::to_value(state).unwrap());
      }

      let new_id = js::add_foreign_connectable(&serde_json::to_string(fc).unwrap());
      new_sid_by_old_sid.insert(fc.id.clone(), new_id.clone());
      fc.id = new_id;
      self.foreign_connectables.push(fc.clone());
    }

    fn map_id(
      new_uuid_by_old_uuid: &FxHashMap<Uuid, Uuid>,
      new_sid_by_old_sid: &FxHashMap<String, String>,
      old_id: &str,
    ) -> Option<String> {
      if let Ok(uuid) = Uuid::from_str(old_id) {
        new_uuid_by_old_uuid.get(&uuid).map(|u| u.to_string())
      } else {
        new_sid_by_old_sid.get(old_id).cloned()
      }
    }

    for vc in &mut serialized.vcs {
      vc.def.subgraph_id = new_uuid_by_old_uuid[&vc.def.subgraph_id];
      let new_id = uuid_v4();
      new_uuid_by_old_uuid.insert(vc.def.uuid, new_id);
      vc.def.uuid = new_id;
    }

    for vc in &mut serialized.vcs {
      let ctx = build_view(&vc.def.name, vc.def.uuid);
      if let Some(val) = &mut vc.localstorage_val {
        // Another special case we have to update is graph editors.
        //
        // Graph editors have to hold IDs of the nodes in their state, and since we're mapping the
        // state around, this causes the positions of nodes to get messed up.
        if vc.def.name == "graph_editor" {
          let mut state: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(val).unwrap();

          // Keys to update: `last_node_id`, `nodes`, `selectedNodeVcId`
          if let Some(serde_json::Value::String(last_node_id)) = state.get_mut("last_node_id") {
            if let Some(mapped_last_node_id) =
              map_id(&new_uuid_by_old_uuid, &new_sid_by_old_sid, last_node_id)
            {
              *last_node_id = mapped_last_node_id
            } else {
              error!(
                "`last_node_id` {last_node_id} from graph editor id {} in serialized subgraph is \
                 not in the subgraph",
                vc.def.uuid
              );
              *last_node_id = String::new();
            };
          }
          if let Some(serde_json::Value::String(selected_node_vc_id)) =
            state.get_mut("selectedNodeVcId")
          {
            if let Some(mapped_selected_node_id) = map_id(
              &new_uuid_by_old_uuid,
              &new_sid_by_old_sid,
              selected_node_vc_id,
            ) {
              *selected_node_vc_id = mapped_selected_node_id
            } else {
              error!(
                "`selected_node_vc_id` {selected_node_vc_id} from graph editor id {} in \
                 serialized subgraph is not in the subgraph",
                vc.def.uuid
              );
              *selected_node_vc_id = String::new();
            };
          }
          if let Some(serde_json::Value::Array(nodes)) = state.get_mut("nodes") {
            // for node in nodes {

            // }
            nodes.retain_mut(|node| {
              if let Some(serde_json::Value::String(vc_id)) = node.get_mut("id") {
                if let Some(mapped_vc_id) =
                  map_id(&new_uuid_by_old_uuid, &new_sid_by_old_sid, vc_id)
                {
                  *vc_id = mapped_vc_id;
                  true
                } else {
                  error!(
                    "`node.id` {vc_id} from graph editor id {} in serialized subgraph is not in \
                     the subgraph",
                    vc.def.uuid
                  );
                  false
                }
              } else {
                false
              }
            })
          }

          *val = serde_json::to_string(&state).unwrap();
        }

        let new_localstorage_key = ctx.get_state_key();
        js::set_localstorage_key(&new_localstorage_key, val);
      }

      self.add_view_context(vc.def.uuid, vc.def.name.clone(), ctx, vc.def.subgraph_id);
    }

    for (id, mut desc) in serialized.subgraphs {
      let new_id = new_uuid_by_old_uuid[&desc.active_vc_id];
      desc.active_vc_id = new_id;
      self.subgraphs_by_id.insert(id, desc.clone());
    }
    js::set_subgraphs(
      &self.active_subgraph_id.to_string(),
      &serde_json::to_string(&self.subgraphs_by_id).unwrap(),
    );

    for conn in &mut serialized.intra_conns {
      let new_tx_id = map_id(&new_uuid_by_old_uuid, &new_sid_by_old_sid, &conn.0.vc_id)
        .unwrap_or_else(|| {
          panic!(
            "Intra conn {conn:?} contains tx ID ({}) which wasn't found in the subgraph",
            conn.0.vc_id
          )
        });
      let new_rx_id = map_id(&new_uuid_by_old_uuid, &new_sid_by_old_sid, &conn.1.vc_id)
        .unwrap_or_else(|| {
          panic!(
            "Intra conn {conn:?} contains tx ID ({}) which wasn't found in the subgraph",
            conn.1.vc_id
          )
        });

      self.connections.push((
        ConnectionDescriptor {
          vc_id: new_tx_id.clone(),
          name: conn.0.name.clone(),
        },
        ConnectionDescriptor {
          vc_id: new_rx_id.clone(),
          name: conn.1.name.clone(),
        },
      ));
      js::add_connection(&new_tx_id, &conn.0.name, &new_rx_id, &conn.1.name);
    }
    js::set_connections(&serde_json::to_string(&self.connections).unwrap());

    // Finally, add a subgraph portal in the active subgraph pointing to the new subgraph with its
    // inputs set to correspond to the one we re-pointed ealier
    let tx_subgraph_id = self.active_subgraph_id;
    let rx_subgraph_id = serialized.base_subgraph_id;
    let (inputs, outputs) = if let Some(base_portal_state) = base_portal_state {
      (
        base_portal_state.registered_outputs,
        base_portal_state.registered_inputs,
      )
    } else {
      self.add_subgraph_portal(rx_subgraph_id, tx_subgraph_id, None, None);
      (None, None)
    };
    info!(
      "Creating subgraph portal from active subgraph to new subgraph; tx={}, rx={}, inputs={:?}, \
       outputs={:?}",
      tx_subgraph_id, rx_subgraph_id, inputs, outputs
    );
    self.add_subgraph_portal(tx_subgraph_id, rx_subgraph_id, inputs, outputs);

    self.save_all();

    serialized.base_subgraph_id
  }

  /// Moves the specified VC/FCs to the specified subgraph, updating the state and committing it to
  /// `localStorage` as well as the frontend.
  ///
  /// Severs any connections that would cross a subgraph boundary as a result of the move.
  pub fn move_vfcs_to_subgraph(&mut self, vfc_ids: Vec<String>, target_subgraph_id: Uuid) {
    let mut vc_ids_to_move = Vec::new();
    let mut fc_ids_to_move = Vec::new();
    // If the VC we're moving is the active VC for the subgraph it's being moved from, we need to
    // set a new active VC for that subgraph
    let mut subgraph_ids_needing_new_active_vc = FxHashSet::default();

    for vfc_id in &vfc_ids {
      if let Ok(uuid) = Uuid::from_str(&vfc_id) {
        if let Some(vc) = self.contexts.iter_mut().find(|vc| vc.id == uuid) {
          vc.definition.subgraph_id = target_subgraph_id;
          vc_ids_to_move.push(uuid);

          if self.subgraphs_by_id[&vc.definition.subgraph_id].active_vc_id == vc.id {
            subgraph_ids_needing_new_active_vc.insert(vc.definition.subgraph_id);
            vc.context.hide();
          }
        }
      } else {
        if let Some(fc) = self
          .foreign_connectables
          .iter_mut()
          .find(|fc| fc.id.as_str() == vfc_id.as_str())
        {
          fc.subgraph_id = target_subgraph_id;
          fc_ids_to_move.push(vfc_id);
        }
      }
    }

    info!(
      "Moving {} vc(s) and {} fc(s) to subgraph id={}",
      vc_ids_to_move.len(),
      fc_ids_to_move.len(),
      target_subgraph_id
    );

    let mut conns_to_remove = Vec::new();
    self.connections = std::mem::take(&mut self.connections)
      .into_iter()
      .filter(|(tx, rx)| {
        let src_subgraph_id = self.get_subgraph_id(&tx.vc_id).unwrap();
        let dst_subgraph_id = self.get_subgraph_id(&rx.vc_id).unwrap();
        if src_subgraph_id == target_subgraph_id && dst_subgraph_id == target_subgraph_id {
          true
        } else if src_subgraph_id == target_subgraph_id || dst_subgraph_id == target_subgraph_id {
          conns_to_remove.push((tx.clone(), rx.clone()));
          false
        } else {
          true
        }
      })
      .collect();

    info!("Removing {} connections", conns_to_remove.len());
    for (tx, rx) in conns_to_remove {
      js::delete_connection(&tx.vc_id, &tx.name, &rx.vc_id, &rx.name);
    }

    js::set_foreign_connectables(&serde_json::to_string(&self.foreign_connectables).unwrap());
    js::set_view_contexts(
      &self.active_context_id.to_string(),
      &serde_json::to_string(
        &self
          .contexts
          .iter()
          .map(|vc| &vc.definition)
          .collect::<Vec<_>>(),
      )
      .unwrap(),
    );

    for subgraph_id in subgraph_ids_needing_new_active_vc {
      let new_active_vc_opt = self
        .contexts
        .iter_mut()
        .find(|vc| vc.definition.subgraph_id == subgraph_id);
      if let Some(vc) = new_active_vc_opt {
        vc.context.unhide();
        self
          .subgraphs_by_id
          .get_mut(&subgraph_id)
          .unwrap()
          .active_vc_id = vc.id;
        if self.active_subgraph_id == subgraph_id {
          self.active_context_id = vc.id;
        }
      }
    }
    js::set_subgraphs(
      &self.active_subgraph_id.to_string(),
      &serde_json::to_string(&self.subgraphs_by_id).unwrap(),
    );

    // Trigger all graph editor VCs in the subgraph the nodes were moved into to arrange the nodes
    // that were moved into it
    for vc in &self.contexts {
      if vc.definition.subgraph_id == target_subgraph_id && vc.definition.name == "graph_editor" {
        let graph_editor = match vc.context.as_any().downcast_ref::<GraphEditor>() {
          Some(ge) => ge,
          None => continue,
        };
        graph_editor.arrange_nodes(Some(&vfc_ids), (20, 400));
      }
    }
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

  pub fn swap_vc_positions(&mut self, a: usize, b: usize) {
    self.contexts.swap(a, b);
    js::set_view_contexts(
      &self.active_context_id.to_string(),
      &serde_json::to_string(
        &self
          .contexts
          .iter()
          .map(|vc| &vc.definition)
          .collect::<Vec<_>>(),
      )
      .unwrap(),
    );
    self.save_all();
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

  fn delete_foreign_connectable_by_id(&mut self, id: &str) {
    self.foreign_connectables.retain(|fc| fc.id != id);
    js::delete_foreign_connectable(&id.to_string());
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
