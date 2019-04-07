use serde_json;
use uuid::Uuid;

use super::{
    super::views::{
        clip_compositor::mk_clip_compositor, faust_editor::mk_faust_editor,
        midi_editor::mk_midi_editor,
    },
    ViewContext,
};
use crate::prelude::*;

/// The `localstorage` key under which the serialized state of the VCM is stored.  This is loaded
/// when the application initializes, and it is periodically updated with a fresh value as the
/// application is updated.
///
/// It doesn't actually contain the data for the individual view contexts, but rather it contains
/// the `localStorage` keys at which they can be retrieved.  This allows individual VCs to be
/// updated without having to re-serialize all of the others as well.
pub const VCM_STATE_KEY: &str = "vcmState";

#[derive(Serialize)]
struct MinimalViewContextDefinition {
    pub name: String,
    pub uuid: Uuid,
}

impl<'a> From<&'a ViewContextEntry> for MinimalViewContextDefinition {
    fn from(other: &'a ViewContextEntry) -> Self {
        MinimalViewContextDefinition {
            name: other.name.clone(),
            uuid: other.uuid,
        }
    }
}

pub struct ViewContextEntry {
    pub uuid: Uuid,
    pub name: String,
    pub context: Box<dyn ViewContext>,
    /// A flag indicating if this entry has received any actions since it was last saved
    pub touched: bool,
}

impl ViewContextEntry {
    pub fn new(uuid: Uuid, name: String, context: Box<dyn ViewContext>) -> Self {
        ViewContextEntry {
            uuid,
            name,
            context,
            touched: false,
        }
    }
}

pub struct ViewContextManager {
    pub active_context_ix: usize,
    pub contexts: Vec<ViewContextEntry>,
}

impl Default for ViewContextManager {
    fn default() -> Self {
        ViewContextManager {
            active_context_ix: 0,
            contexts: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct ViewContextDefinition {
    pub uuid: Uuid,
    pub name: String,
    pub conf: String,
}

impl<'a> Into<ViewContextDefinition> for &'a mut ViewContextEntry {
    fn into(self) -> ViewContextDefinition {
        ViewContextDefinition {
            uuid: self.uuid,
            name: self.name.clone(),
            conf: self.context.save(),
        }
    }
}

/// Represents the state of the application in a form that can be serialized and deserialized into
/// the browser's `localstorage` to refresh the state from scratch when the application reloads.
#[derive(Serialize, Deserialize)]
struct ViewContextManagerState {
    /// This contains the IDs of all managed VCs.  The actual `ViewContextDefinition`s for each of
    /// them are found in separate `localStorage` entries.
    pub view_context_ids: Vec<Uuid>,
    pub active_view_ix: usize,
}

fn get_vc_key(uuid: Uuid) -> String { format!("vc_{}", uuid) }

impl ViewContextManager {
    /// Adds a `ViewContext` instance to be managed by the `ViewContextManager`.  Returns its index.
    fn add_view_context_inner(
        &mut self,
        uuid: Uuid,
        name: String,
        view_context: Box<dyn ViewContext>,
    ) -> usize {
        self.contexts.push(ViewContextEntry {
            uuid,
            name,
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
        let created_ix = self.add_view_context_inner(uuid, name, view_context);
        self.commit();
        created_ix
    }

    /// Given the UUID of a managed `ViewContext`, switches it to be the active view.
    pub fn set_active_view_by_id(&mut self, id: Uuid) {
        let ix = match self.get_vc_position(id) {
            Some(ix) => ix,
            None => {
                error!("Tried to delete a VC with ID {} but it wasn't found.", id);
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

            let view_context =
                build_view(&definition.name, Some(&definition.conf), definition.uuid);
            self.add_view_context_inner(definition.uuid, definition.name, view_context);
        }

        self.active_context_ix = vcm_state.active_view_ix;
    }

    /// Initializes the VCM with the default view context and state from scratch
    fn init_default_state(&mut self) {
        let uuid = uuid_v4();
        let view = build_view("midi_editor", None, uuid);
        self.add_view_context_inner(uuid_v4(), "midi_editor".into(), view);
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

        self.contexts[self.active_context_ix].context.init();

        self.commit();
    }

    /// Retrieves the active `ViewContextManager`
    pub fn get_active_view(&self) -> &dyn ViewContext {
        &*self.contexts[self.active_context_ix].context
    }

    /// Retrieves the active `ViewContextManager`
    pub fn get_active_view_mut(&mut self) -> &mut dyn ViewContext {
        &mut *self.contexts[self.active_context_ix].context
    }

    /// Updates the UI with an up-to-date listing of active view contexts and persist the current
    /// VCM state to `localStorage`.
    fn commit(&mut self) {
        let minimal_view_context_definitions: Vec<MinimalViewContextDefinition> = self
            .contexts
            .iter()
            .map(|vc_entry| vc_entry.into())
            .collect();
        let definitions_str = serde_json::to_string(&minimal_view_context_definitions)
            .expect("Error serializing `MinimalViewContextDefinition`s into JSON string");

        js::update_active_view_contexts(self.active_context_ix, &definitions_str);

        self.save_all()
    }

    pub fn get_vc_position(&self, id: Uuid) -> Option<usize> {
        self.contexts
            .iter()
            .position(|vc_entry| vc_entry.uuid == id)
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
        vc_entry.context.cleanup();

        // If the deleted VC was the active VC, pick the one before it to be the active VC.
        if self.active_context_ix == ix {
            self.active_context_ix = ix.saturating_sub(1);
        }

        if let Some(vc_entry) = self.contexts.get_mut(self.active_context_ix) {
            vc_entry.context.init();
        }

        self.commit();
    }

    /// Serializes all managed view contexts and saves them to persistent storage.
    pub fn save_all(&mut self) {
        // TODO: Periodically call this, probably from inside of the VCMs themselves, in order
        // to keep the state up to date.
        // TODO: Actually make use of the `touched` flag optimization here.
        let mut view_context_definitions = Vec::new();
        let mut view_context_ids = Vec::new();

        for entry in &mut self.contexts {
            view_context_ids.push(entry.uuid);
            let view_context_definition: ViewContextDefinition = entry.into();
            js::set_localstorage_key(
                &get_vc_key(view_context_definition.uuid),
                &serde_json::to_string(&view_context_definition)
                    .expect("Error while serializing `ViewContextDefinition`"),
            );
            view_context_definitions.push(view_context_definition);
        }

        let state = ViewContextManagerState {
            view_context_ids,
            active_view_ix: self.active_context_ix,
        };

        let serialized_state: String = serde_json::to_string(&state)
            .expect("Error while serializing `ViewContextManagerState` to string");

        js::set_localstorage_key(VCM_STATE_KEY, &serialized_state);
    }

    pub fn set_active_view(&mut self, view_ix: usize) {
        self.save_all();
        self.get_active_view_mut().cleanup();
        self.active_context_ix = view_ix;
        self.get_active_view_mut().init();
        self.commit();
    }

    /// Resets the VCM to its initial state, deleting all existing VCs.
    pub fn reset(&mut self) {
        // clean-up the active VC first
        self.get_active_view_mut().cleanup();

        if let Some(vcm_state) = Self::load_vcm_state() {
            // Delete all stored VCs
            for vc_id in vcm_state.view_context_ids {
                let key = get_vc_key(vc_id);
                js::delete_localstorage_key(&key);
            }
        }

        // Delete the VCM root state key itself
        js::delete_localstorage_key(VCM_STATE_KEY);

        // Re-initialize from scratch
        self.contexts.clear();
        self.active_context_ix = 0;
        self.init();
    }
}

pub fn build_view(name: &str, conf: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
    match name {
        "midi_editor" => mk_midi_editor(conf, uuid),
        "clip_compositor" => mk_clip_compositor(conf, uuid),
        "faust_editor" => mk_faust_editor(conf, uuid),
        _ => panic!("No handler for view context with name {}", name),
    }
}
