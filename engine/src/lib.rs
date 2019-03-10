#![feature(box_syntax, test, slice_patterns, thread_local, nll)]
#![allow(clippy::float_cmp)]

extern crate base64;
extern crate bincode;
extern crate common;
extern crate fnv;
extern crate rand;
extern crate rand_pcg;
extern crate serde;
extern crate slab;
extern crate test;
extern crate wasm_bindgen;
#[macro_use]
extern crate serde_derive;

pub mod constants;
pub mod helpers;
pub mod js;
pub mod prelude;
pub mod synth;
pub mod util;
pub mod view_context;
pub mod views;
use self::prelude::*;

/// Entrypoint for the application.  This function is called from the JS side as soon as the Wasm
/// blob is loaded.  It handles setting up application state, rendering the initial UI, and loading
/// the last saved composition from the user.
#[wasm_bindgen]
pub fn init() {
    common::set_panic_hook();

    // TODO: Create `ViewContextManager`, load saved context, and initialize active views
}
