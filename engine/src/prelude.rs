//! Re-exports many common functions, structs, and other things that are useful in multiple
//! parts of the application and would be tedious to import individually.

use std::ptr;

pub use wasm_bindgen::prelude::*;

use rand_pcg::Pcg32;

pub static mut RNG: *mut Pcg32 = ptr::null_mut();

pub fn rng() -> &'static mut Pcg32 { unsafe { &mut *RNG } }

pub use super::{
    constants::*,
    get_vcm,
    helpers::grid::GridRendererUniqueIdentifier,
    js,
    synth::{self, PolySynth},
    util::{self, *},
    view_context::{self, manager::ViewContextDefinition, ViewContext, ViewContextManager},
};
