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

pub mod composition_saving_loading;
pub mod constants;
pub mod input_handlers;
pub mod js;
pub mod note_box;
pub mod note_utils;
pub mod prelude;
pub mod render;
pub mod selection_box;
pub mod skip_list;
pub mod state;
pub mod synth;
pub mod util;
pub mod view_context;
use self::prelude::*;

/// Entrypoint for the application.  This function is called from the JS side as soon as the Wasm
/// blob is loaded.  It handles setting up application state, rendering the initial UI, and loading
/// the last saved composition from the user.
#[wasm_bindgen]
pub fn init() {
    common::set_panic_hook();
    unsafe { state::init_state() };
    render::draw_grid();
    render::draw_measure_lines();
    render::draw_cursor_gutter();
    state().cursor_dom_id = render::draw_cursor();
    try_load_saved_composition();
}
