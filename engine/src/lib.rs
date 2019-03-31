#![feature(
    box_syntax,
    test,
    slice_patterns,
    thread_local,
    nll,
    bind_by_move_pattern_guards
)]
#![allow(clippy::float_cmp, clippy::needless_range_loop, clippy::manual_memcpy)]

extern crate base64;
extern crate bincode;
extern crate fnv;
extern crate rand;
extern crate rand_pcg;
extern crate serde;
extern crate slab;
extern crate test;
extern crate wasm_bindgen;
#[macro_use]
extern crate serde_derive;
#[macro_use]
extern crate log;

use std::ptr;

use rand_pcg::Pcg32;
use wasm_bindgen::prelude::*;

pub mod constants;
pub mod helpers;
pub mod js;
pub mod prelude;
pub mod synth;
pub mod util;
pub mod view_context;
pub mod views;
use self::prelude::*;

/// The global view context manager that holds all of the view contexts for the application.
static mut VIEW_CONTEXT_MANAGER: *mut ViewContextManager = ptr::null_mut();

/// Retrieves the global `ViewContextManager` for the application
pub fn get_vcm() -> &'static mut ViewContextManager { unsafe { &mut *VIEW_CONTEXT_MANAGER } }

/// Entrypoint for the application.  This function is called from the JS side as soon as the Wasm
/// blob is loaded.  It handles setting up application state, rendering the initial UI, and loading
/// the last saved composition from the user.
#[wasm_bindgen]
pub fn init() {
    console_error_panic_hook::set_once();

    let log_level = if cfg!(debug_assertions) {
        // log::Level::Debug
        log::Level::Trace
    } else {
        log::Level::Info
    };
    wasm_logger::init(wasm_logger::Config::new(log_level));

    // Create the `ViewContextManager` and a `MidiEditor` and initialize them
    let view = view_context::manager::build_view("midi_editor", "TODO");
    let mut vcm = box ViewContextManager::default();
    vcm.add_view(view);
    vcm.init();
    unsafe { VIEW_CONTEXT_MANAGER = Box::into_raw(vcm) };

    // Initialize the global PRNG
    unsafe {
        // slightly customized versions of the default seeds for the PCG32 PRNG
        RNG = Box::into_raw(box Pcg32::new(
            0x1ade_f00d_d15b_a5e5,
            721_347_520_420_481_703,
        ))
    }
}
