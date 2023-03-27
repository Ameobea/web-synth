//! Re-exports many common functions, structs, and other things that are useful in multiple
//! parts of the application and would be tedious to import individually.

pub use wasm_bindgen::prelude::*;

pub use common::{rng, uuid_v4};

pub use super::{
  get_vcm, js,
  view_context::{
    self,
    manager::{ConnectionDescriptor, ViewContextDefinition},
    ViewContext, ViewContextManager,
  },
};
