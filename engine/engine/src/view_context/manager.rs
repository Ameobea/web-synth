use serde_json;
use uuid::Uuid;

use crate::{
    prelude::*,
    views::{
        clip_compositor::mk_clip_compositor,
        composition_sharing::mk_composition_sharing,
        control_panel::mk_control_panel,
        faust_editor::{mk_faust_editor, FaustEditor},
        graph_editor::mk_graph_editor,
        midi_editor::mk_midi_editor,
        midi_keyboard::mk_midi_keyboard,
        sample_library::mk_sample_library,
        sequencer::mk_sequencer,
        synth_designer::mk_synth_designer,
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

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct MinimalViewContextDefinition {
    pub name: String,
    pub uuid: Uuid,
    pub title: Option<String>,
}

pub struct ViewContextEntry {
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
    pub serialized_state: Option<serde_json::Value>,
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
    pub conf: String,
}

impl<'a> Into<ViewContextDefinition> for &'a mut ViewContextEntry {
    fn into(self) -> ViewContextDefinition {
        ViewContextDefinition {
            minimal_def: self.definition.clone(),
            conf: self.context.save(),
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
    pub view_context_ids: Vec<Uuid>,
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
                uuid,
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
            let definition: ViewContextDefinition = match serde_json::from_str(&definition_str) {
                Ok(definition) => definition,
                Err(err) => {
                    error!("Error deserializing `ViewContextDefinition`: {:?}", err);
                    continue;
                },
            };

            let mut view_context = build_view(
                &definition.minimal_def.name,
                Some(&definition.conf),
                definition.minimal_def.uuid,
            );

            view_context.init();
            view_context.hide();

            self.add_view_context_inner(definition.minimal_def, view_context);
        }

        self.active_context_ix = vcm_state.active_view_ix;
        self.connections = vcm_state.patch_network_connections;
        self.foreign_connectables = vcm_state.foreign_connectables;
    }

    /// Initializes the VCM with the default view context and state from scratch
    fn init_default_state(&mut self) {
        let uuid = uuid_v4();
        let mut graph_editor_view_context = build_view("graph_editor", None, uuid);
        graph_editor_view_context.init();
        graph_editor_view_context.hide();
        self.add_view_context_inner(
            MinimalViewContextDefinition {
                uuid,
                name: "graph_editor".into(),
                title: Some("Graph Editor".into()),
            },
            graph_editor_view_context,
        );

        let uuid = uuid_v4();
        // Create a MIDI Editor view context
        let mut view_context = build_view("midi_editor", None, uuid);
        view_context.init();
        view_context.hide();
        self.add_view_context_inner(
            MinimalViewContextDefinition {
                uuid,
                name: "midi_editor".into(),
                title: Some("MIDI Editor".into()),
            },
            view_context,
        );

        let uuid = uuid_v4();
        let mut synth_designer_context = build_view("synth_designer", None, uuid);
        synth_designer_context.init();
        synth_designer_context.hide();
        self.add_view_context_inner(
            MinimalViewContextDefinition {
                uuid,
                name: "synth_designer".into(),
                title: Some("Synth Designer".into()),
            },
            synth_designer_context,
        );

        // Create a Faust Editor view context
        let uuid = uuid_v4();
        let faust_editor = FaustEditor { uuid };
        let state_key = faust_editor.get_state_key();
        let mut view_context = build_view(
            "faust_editor",
            Some(&serde_json::to_string(&faust_editor).unwrap()),
            uuid,
        );
        view_context.init();
        view_context.hide();
        self.add_view_context_inner(
            MinimalViewContextDefinition {
                uuid,
                name: "faust_editor".into(),
                title: Some("Faust Editor".into()),
            },
            view_context,
        );
        let faust_editor_content = include_str!("../../static/rain.dsp");
        js::set_localstorage_key(&state_key, faust_editor_content);

        let destination_id = 1;
        self.foreign_connectables.push(ForeignConnectable {
            _type: "customAudio/destination".into(),
            id: destination_id.to_string(),
            serialized_state: None,
        });

        // Connect the MIDI editor to the Synth Designer and the Synth Designer to the Faust Editor
        let (midi_id, synth_id, faust_id) = (
            self.contexts[1].definition.uuid,
            self.contexts[2].definition.uuid,
            self.contexts[3].definition.uuid,
        );
        self.connections.push((
            ConnectionDescriptor {
                vc_id: midi_id.to_string(),
                name: "midi_output".into(),
            },
            ConnectionDescriptor {
                vc_id: synth_id.to_string(),
                name: "midi".into(),
            },
        ));
        self.connections.push((
            ConnectionDescriptor {
                vc_id: synth_id.to_string(),
                name: "masterOutput".into(),
            },
            ConnectionDescriptor {
                vc_id: faust_id.to_string(),
                name: "input".into(),
            },
        ));
        self.connections.push((
            ConnectionDescriptor {
                vc_id: faust_id.to_string(),
                name: "output".into(),
            },
            ConnectionDescriptor {
                vc_id: destination_id.to_string(),
                name: "input".into(),
            },
        ));

        self.active_context_ix = 0;
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
            self.init_default_state();
        }

        self.contexts[self.active_context_ix].context.unhide();

        self.commit();
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
        let definitions_str = serde_json::to_string(&minimal_view_context_definitions)
            .expect("Error serializing `MinimalViewContextDefinition`s into JSON string");
        let connections_json = serde_json::to_string(&self.connections)
            .expect("Failed to JSON serialize patch network connections");
        let foreign_connectables_json = serde_json::to_string(&self.foreign_connectables)
            .expect("Failed to JSON serialize foreign connectables");

        js::init_view_contexts(
            self.active_context_ix,
            &definitions_str,
            &connections_json,
            &foreign_connectables_json,
        );

        self.save_all()
    }

    pub fn get_vc_position(&self, id: Uuid) -> Option<usize> {
        self.contexts
            .iter()
            .position(|vc_entry| vc_entry.definition.uuid == id)
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
            view_context_ids.push(entry.definition.uuid);
            let view_context_definition: ViewContextDefinition = entry.into();
            js::set_localstorage_key(
                &get_vc_key(view_context_definition.minimal_def.uuid),
                &serde_json::to_string(&view_context_definition)
                    .expect("Error while serializing `ViewContextDefinition`"),
            );
            view_context_definitions.push(view_context_definition);
        }

        let state = ViewContextManagerState {
            view_context_ids,
            active_view_ix: self.active_context_ix,
            patch_network_connections: self.connections.clone(),
            foreign_connectables: self.foreign_connectables.clone(),
        };

        let serialized_state: String = serde_json::to_string(&state)
            .expect("Error while serializing `ViewContextManagerState` to string");

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
        let contexts_to_delete: Vec<Uuid> = self
            .contexts
            .iter()
            .map(|entry| entry.definition.uuid)
            .collect();
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

pub fn build_view(name: &str, conf: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
    match name {
        "midi_editor" => mk_midi_editor(conf, uuid),
        "clip_compositor" => mk_clip_compositor(conf, uuid),
        "faust_editor" => mk_faust_editor(conf, uuid),
        "graph_editor" => mk_graph_editor(conf, uuid),
        "composition_sharing" => mk_composition_sharing(conf, uuid),
        "synth_designer" => mk_synth_designer(conf, uuid),
        "midi_keyboard" => mk_midi_keyboard(conf, uuid),
        "sequencer" => mk_sequencer(conf, uuid),
        "sample_library" => mk_sample_library(conf, uuid),
        "control_panel" => mk_control_panel(conf, uuid),
        _ => panic!("No handler for view context with name {}", name),
    }
}
