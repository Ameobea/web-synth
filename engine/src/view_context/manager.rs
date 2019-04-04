use serde_json;
use uuid::Uuid;

use super::{
    super::views::{clip_compositor::mk_clip_compositor, midi_editor::mk_midi_editor},
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
const VCM_STATE_KEY: &str = "vcmState";

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
struct ViewContextDefinition {
    pub uuid: Uuid,
    pub name: String,
    pub conf: String,
}

impl<'a> Into<ViewContextDefinition> for &'a ViewContextEntry {
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

impl ViewContextManager {
    /// Adds a `ViewContext` instance to be managed by the `ViewContextManager`
    pub fn add_view_context(
        &mut self,
        uuid: Uuid,
        name: String,
        view_context: Box<dyn ViewContext>,
    ) {
        self.contexts.push(ViewContextEntry {
            uuid,
            name,
            context: view_context,
            touched: false,
        });
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

            let view_context = build_view(&definition.name, &definition.conf);
            self.add_view_context(definition.uuid, definition.name, view_context);
        }

        self.active_context_ix = vcm_state.active_view_ix;
    }

    /// Initializes the VCM with the default view context and state from scratch
    fn init_default_state(&mut self) {
        let view = build_view("clip_compositor", "TODO");
        self.add_view_context(uuid_v4(), "clip_compositor".into(), view);
    }

    /// Loads saved application state from the browser's `localstorage`.  Then calls the `init()`
    /// function of all managed `ViewContext`s.
    pub fn init(&mut self) {
        let vcm_state_str_opt = js::get_localstorage_key(VCM_STATE_KEY);
        if let Some(vcm_state_str) = vcm_state_str_opt {
            match serde_json::from_str(&vcm_state_str) {
                Ok(vcm_state) => self.init_from_state_snapshot(vcm_state),
                Err(err) => error!("Error deserializing stored VCM state: {:?}", err),
            };
        } else {
            self.init_default_state();
        }

        self.contexts[self.active_context_ix].context.init();
    }

    /// Creates a snapshot of the current application state and saves it to `localstorage`.
    pub fn save_state_snapshot(&self) {
        // TODO: Periodically call this, probably from inside of the VCMs themselves, in order
        // to keep the state up to date.
        // TODO: Actually make use of the `touched` flag optimization here.
        let mut view_context_definitions = Vec::new();
        let mut view_context_ids = Vec::new();

        for entry in &self.contexts {
            view_context_ids.push(entry.uuid);
            let view_context_definition: ViewContextDefinition = entry.into();
            js::set_localstorage_key(
                &format!("vc_{}", view_context_definition.uuid),
                &view_context_definition.conf,
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

    /// Retrieves the active `ViewContextManager`
    pub fn get_active_view(&self) -> &dyn ViewContext {
        &*self.contexts[self.active_context_ix].context
    }

    /// Retrieves the active `ViewContextManager`
    pub fn get_active_view_mut(&mut self) -> &mut dyn ViewContext {
        &mut *self.contexts[self.active_context_ix].context
    }

    /// Serializes all managed view contexts and saves them to persistent storage.
    pub fn save_all(&mut self) {
        for entry in &self.contexts {
            if !entry.touched {
                continue;
            }

            let _serialized = entry.context.save();
            // TODO: save to localstorage or something
        }
    }

    pub fn set_active_view(&mut self, view_ix: usize) {
        self.save_all();
        self.get_active_view_mut().cleanup();
        self.active_context_ix = view_ix;
        self.get_active_view_mut().init();
    }
}

pub fn build_view(name: &str, definition: &str) -> Box<dyn ViewContext> {
    match name {
        "midi_editor" => mk_midi_editor(definition),
        "clip_compositor" => mk_clip_compositor(definition),
        _ => unimplemented!(),
    }
}
