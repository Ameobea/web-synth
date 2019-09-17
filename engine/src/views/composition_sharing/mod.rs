//! Defines a view that creates an interface for sharing compositions + browsing shared compositions

use serde_json;
use uuid::Uuid;

use crate::{helpers::grid::prelude::*, view_context::ViewContext};

/// This is just a shim to the JS-based composition sharing UI.  Since there really aren't any
/// complicated interactive or graphical components of this view context, the actual implementation
/// for this is done in JS.
#[derive(Serialize, Deserialize)]
pub struct CompositionSharing {
    pub uuid: Uuid,
}

impl CompositionSharing {
    pub fn new(uuid: Uuid) -> Self { CompositionSharing { uuid } }

    pub fn get_state_key(&self) -> String { format!("compositionSharing_{}", self.uuid) }
}

impl ViewContext for CompositionSharing {
    fn init(&mut self) { js::init_composition_sharing(&self.get_state_key()); }

    fn cleanup(&mut self) { js::cleanup_composition_sharing(); }

    fn dispose(&mut self) { js::delete_localstorage_key(&self.get_state_key()); }

    fn save(&mut self) -> String {
        serde_json::to_string(self).expect("Error serializing `CompositionSharing` to String")
    }
}

pub fn mk_composition_sharing(definition_opt: Option<&str>, uuid: Uuid) -> Box<dyn ViewContext> {
    let composition_sharing: CompositionSharing = match definition_opt {
        Some(definition) => serde_json::from_str(definition)
            .expect("Error while deserializing `CompositionSharing`"),
        None => CompositionSharing::new(uuid),
    };
    Box::new(composition_sharing)
}
