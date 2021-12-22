use std::str::FromStr;

use miniserde::{json, Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    prelude::*,
    views::{
        composition_sharing::mk_composition_sharing,
        control_panel::mk_control_panel,
        faust_editor::{mk_faust_editor, FaustEditor},
        filter_designer::mk_filter_designer,
        granulator::mk_granulator,
        graph_editor::mk_graph_editor,
        looper::mk_looper,
        midi_editor::mk_midi_editor,
        midi_keyboard::mk_midi_keyboard,
        sample_library::mk_sample_library,
        sequencer::mk_sequencer,
        sinsy::mk_sinsy,
        synth_designer::{mk_synth_designer, SynthDesigner},
    },
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
    #[serde(rename = "serializedState")]
    pub serialized_state: Option<json::Value>,
}

pub struct ViewContextManager {
    pub active_context_ix: usize,
    pub contexts: Vec<ViewContextEntry>,
    pub connections: Vec<(ConnectionDescriptor, ConnectionDescriptor)>,
    pub foreign_connectables: Vec<ForeignConnectable>,
}

impl Default for ViewContextManager {
    fn default() -> Self {
        ViewContextManager {
            active_context_ix: 0,
            contexts: Vec::new(),
            connections: Vec::new(),
            foreign_connectables: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct ViewContextDefinition {
    pub minimal_def: MinimalViewContextDefinition,
}

impl<'a> Into<ViewContextDefinition> for &'a mut ViewContextEntry {
    fn into(self) -> ViewContextDefinition {
        ViewContextDefinition {
            minimal_def: self.definition.clone(),
        }
    }
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
/// the browser's `localstorage` to refresh the state from scratch when the application reloads.
#[derive(Serialize, Deserialize)]
struct ViewContextManagerState {
    /// This contains the IDs of all managed VCs.  The actual `ViewContextDefinition`s for each of
    /// them are found in separate `localStorage` entries.
    pub view_context_ids: Vec<String>,
    pub active_view_ix: usize,
    pub patch_network_connections: Vec<(ConnectionDescriptor, ConnectionDescriptor)>,
    pub foreign_connectables: Vec<ForeignConnectable>,
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
        view_context: Box<dyn ViewContext>,
    ) -> usize {
        let created_ix = self.add_view_context_inner(
            MinimalViewContextDefinition {
                uuid: uuid.to_string(),
                name: name.clone(),
                title: None,
            },
            view_context,
        );

        js::add_view_context(&uuid.to_string(), &name);

        self.save_all();
        created_ix
    }

    pub fn get_vc_by_id_mut(&mut self, uuid: Uuid) -> Option<&mut ViewContextEntry> {
        self.get_vc_position(uuid)
            .map(move |ix| &mut self.contexts[ix])
    }

    pub fn get_vc_by_id(&self, uuid: Uuid) -> Option<&ViewContextEntry> {
        self.get_vc_position(uuid).map(move |ix| &self.contexts[ix])
    }

    /// Given the UUID of a managed `ViewContext`, switches it to be the active view.
    pub fn set_active_view_by_id(&mut self, id: Uuid) {
        let ix = match self.get_vc_position(id) {
            Some(ix) => ix,
            None => {
                error!(
                    "Tried to switch the active VC to one with ID {} but it wasn't found.",
                    id
                );
                return;
            },
        };

        self.set_active_view(ix);
    }

    fn init_from_state_snapshot(&mut self, vcm_state: ViewContextManagerState) {
        for vc_id in vcm_state.view_context_ids {
            let definition_str = match js::get_localstorage_key(&format!("vc_{}", vc_id)) {
                Some(definition) => definition,
                None => {
                    error!(
                        "Attempted to look up VC `localStorage` entry \"{}\" listed in {} but it \
                         wasn't found.",
                        vc_id, VCM_STATE_KEY
                    );
                    continue;
                },
            };
            let definition: ViewContextDefinition = match json::from_str(&definition_str) {
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

        self.active_context_ix = vcm_state.active_view_ix;
        self.connections = vcm_state.patch_network_connections;
        self.foreign_connectables = vcm_state.foreign_connectables;
    }

    /// Initializes the VCM with the default view context and state from scratch.  Returns the UUID
    /// of the graph editor that is created.
    fn init_default_state(&mut self) -> Uuid {
        let graph_editor_vc_id = uuid_v4();
        let mut graph_editor_view_context = build_view("graph_editor", graph_editor_vc_id);
        graph_editor_view_context.init();
        graph_editor_view_context.hide();
        self.add_view_context_inner(
            MinimalViewContextDefinition {
                uuid: graph_editor_vc_id.to_string(),
                name: "graph_editor".into(),
                title: Some("Graph Editor".into()),
            },
            graph_editor_view_context,
        );

        // MIDI Keyboard
        let uuid = uuid_v4();
        let mut midi_keyboard_view_context = build_view("midi_keyboard", uuid);
        midi_keyboard_view_context.init();
        midi_keyboard_view_context.hide();
        self.add_view_context_inner(
            MinimalViewContextDefinition {
                uuid: uuid.to_string(),
                name: "midi_keyboard".into(),
                title: Some("MIDI Keyboard".into()),
            },
            midi_keyboard_view_context,
        );

        // MIDI Editor
        let uuid = uuid_v4();
        let mut view_context = build_view("midi_editor", uuid);
        view_context.init();
        view_context.hide();
        self.add_view_context_inner(
            MinimalViewContextDefinition {
                uuid: uuid.to_string(),
                name: "midi_editor".into(),
                title: Some("MIDI Editor".into()),
            },
            view_context,
        );

        // Synth Designer
        let uuid = uuid_v4();
        let mut synth_designer_context = box SynthDesigner { uuid };
        synth_designer_context.init();
        synth_designer_context.hide();
        self.add_view_context_inner(
            MinimalViewContextDefinition {
                uuid: uuid.to_string(),
                name: "synth_designer".into(),
                title: Some("Synth Designer".into()),
            },
            synth_designer_context,
        );

        // Faust Editor
        let uuid = uuid_v4();
        let mut faust_editor_ctx = box FaustEditor { uuid };
        let state_key = faust_editor_ctx.get_state_key();

        let faust_editor_content = format!(
            r#"{{"editorContent": {}, "isRunning": true, "language": "faust" }}"#,
            include_str!("../../static/flanger.dsp")
        );
        js::set_localstorage_key(&state_key, &faust_editor_content);

        faust_editor_ctx.init();
        faust_editor_ctx.hide();
        self.add_view_context_inner(
            MinimalViewContextDefinition {
                uuid: uuid.to_string(),
                name: "faust_editor".into(),
                title: Some("Code Editor".into()),
            },
            faust_editor_ctx,
        );

        let destination_id = 1;
        self.foreign_connectables.push(ForeignConnectable {
            _type: "customAudio/destination".into(),
            id: format!("{}", destination_id),
            serialized_state: None,
        });

        // Connect MIDI Keyboard -> MIDI Editor -> Synth Designer -> Faust Editor
        let (midi_keyboard_id, midi_editor_id, synth_id, faust_id) = (
            self.contexts[1].definition.uuid.clone(),
            self.contexts[2].definition.uuid.clone(),
            self.contexts[3].definition.uuid.clone(),
            self.contexts[4].definition.uuid.clone(),
        );
        self.connections.push((
            ConnectionDescriptor {
                vc_id: midi_keyboard_id,
                name: "midi out".to_string(),
            },
            ConnectionDescriptor {
                vc_id: midi_editor_id.to_string(),
                name: "midi_in".to_string(),
            },
        ));
        self.connections.push((
            ConnectionDescriptor {
                vc_id: midi_editor_id,
                name: "midi_out".into(),
            },
            ConnectionDescriptor {
                vc_id: synth_id.to_string(),
                name: "midi".into(),
            },
        ));
        self.connections.push((
            ConnectionDescriptor {
                vc_id: synth_id,
                name: "masterOutput".into(),
            },
            ConnectionDescriptor {
                vc_id: faust_id.to_string(),
                name: "input".into(),
            },
        ));
        self.connections.push((
            ConnectionDescriptor {
                vc_id: faust_id,
                name: "output".into(),
            },
            ConnectionDescriptor {
                vc_id: destination_id.to_string(),
                name: "input".into(),
            },
        ));

        self.active_context_ix = 0;
        graph_editor_vc_id
    }

    fn load_vcm_state() -> Option<ViewContextManagerState> {
        let vcm_state_str_opt = js::get_localstorage_key(VCM_STATE_KEY);
        vcm_state_str_opt.and_then(|vcm_state_str| match json::from_str(&vcm_state_str) {
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
        let graph_editor_vc_id = if let Some(vcm_state) = Self::load_vcm_state() {
            self.init_from_state_snapshot(vcm_state);
            None
        } else {
            let graph_editor_vc_id = self.init_default_state();
            Some(graph_editor_vc_id)
        };

        if self.active_context_ix >= self.contexts.len() {
            self.active_context_ix = 0;
        }
        self.contexts[self.active_context_ix].context.unhide();

        self.commit();
        if let Some(graph_editor_vc_id) = graph_editor_vc_id {
            js::arrange_graph_editor(&graph_editor_vc_id.to_string());
        }
    }

    /// Retrieves the active `ViewContextManager`
    pub fn get_active_view(&self) -> &dyn ViewContext {
        &*self.contexts[self.active_context_ix].context
    }

    /// Retrieves the active `ViewContextManager`
    pub fn get_active_view_mut(&mut self) -> &mut dyn ViewContext {
        if self.contexts.len() <= self.active_context_ix {
            panic!(
                "Invalid VCM state; we only have {} VCs managed but active_context_ix is {}",
                self.contexts.len(),
                self.active_context_ix
            );
        }
        &mut *self.contexts[self.active_context_ix].context
    }

    /// Updates the UI with an up-to-date listing of active view contexts and persist the current
    /// VCM state to `localStorage`.
    pub fn commit(&mut self) {
        let minimal_view_context_definitions: Vec<MinimalViewContextDefinition> = self
            .contexts
            .iter()
            .map(|vc_entry| vc_entry.definition.clone())
            .collect();
        let definitions_str = json::to_string(&minimal_view_context_definitions);
        let connections_json = json::to_string(&self.connections);
        let foreign_connectables_json = json::to_string(&self.foreign_connectables);

        js::init_view_contexts(
            self.active_context_ix,
            &definitions_str,
            &connections_json,
            &foreign_connectables_json,
        );

        self.save_all()
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

        let mut vc_entry = self.contexts.remove(ix);
        // Unrender it
        vc_entry.context.cleanup();
        // And clean up any of its attached resources of storage assets
        vc_entry.context.dispose();
        // Finally delete the VC entry for the VC itself
        js::delete_localstorage_key(&get_vc_key(id));

        let old_active_vc_ix = self.active_context_ix;
        if self.active_context_ix == ix {
            // If the deleted VC was the active VC, pick the one before it to be the active VC.
            self.active_context_ix = ix.saturating_sub(1);
        } else if self.active_context_ix > ix {
            // If the active view context is above the one that was removed, shift it one down
            self.active_context_ix = self.active_context_ix - 1;
        }

        if let Some(vc_entry) = self.contexts.get_mut(self.active_context_ix) {
            vc_entry.context.unhide();
        }

        js::delete_view_context(&id.to_string());
        if old_active_vc_ix != self.active_context_ix {
            self.get_active_view_mut().unhide();
            js::set_active_vc_ix(self.active_context_ix);
        }

        self.save_all();
    }

    /// Serializes all managed view contexts and saves them to persistent storage.
    pub fn save_all(&mut self) {
        // TODO: Periodically call this, probably from inside of the VCMs themselves, in order
        // to keep the state up to date.
        // TODO: Actually make use of the `touched` flag optimization here.
        let mut view_context_definitions = Vec::new();
        let mut view_context_ids = Vec::new();

        for entry in &mut self.contexts {
            view_context_ids.push(entry.definition.uuid.clone());
            let vc_id = entry.id;
            let view_context_definition: ViewContextDefinition = entry.into();
            js::set_localstorage_key(
                &get_vc_key(vc_id),
                &json::to_string(&view_context_definition),
            );
            view_context_definitions.push(view_context_definition);
        }

        let state = ViewContextManagerState {
            view_context_ids,
            active_view_ix: self.active_context_ix,
            patch_network_connections: self.connections.clone(),
            foreign_connectables: self.foreign_connectables.clone(),
        };

        let serialized_state: String = json::to_string(&state);

        js::set_localstorage_key(VCM_STATE_KEY, &serialized_state);
    }

    pub fn set_active_view(&mut self, view_ix: usize) {
        self.save_all();
        self.get_active_view_mut().hide();
        self.active_context_ix = view_ix;
        self.get_active_view_mut().unhide();
        js::set_active_vc_ix(view_ix);
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
        self.init();
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
        _ => panic!("No handler for view context with name {}", name),
    }
}
