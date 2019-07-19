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
extern crate serde_json;
#[macro_use]
extern crate log;
extern crate uuid;

use std::{mem, ptr, str::FromStr};

use rand::prelude::*;
use rand_pcg::Pcg32;
use uuid::Uuid;
use wasm_bindgen::prelude::*;

pub mod constants;
pub mod helpers;
pub mod input_handlers;
pub mod js;
pub mod prelude;
pub mod synth;
pub mod util;
pub mod view_context;
pub mod views;
use self::{prelude::*, view_context::manager::build_view};

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

    // Initialize the global PRNG
    unsafe {
        // slightly customized versions of the default seeds for the PCG32 PRNG, but seeded with
        // some actual RNG from JS so that things aren't deterministic.
        RNG = Box::into_raw(box Pcg32::new(
            mem::transmute(js::js_random()),
            721_347_520_420_481_703,
        ))
    }

    // Pump it a few times because it seems to generate a fully null output the first time
    let _: usize = rng().gen();
    let _: usize = rng().gen();

    let log_level = if cfg!(debug_assertions) {
        log::Level::Debug
    // log::Level::Trace
    } else {
        log::Level::Info
    };
    wasm_logger::init(wasm_logger::Config::new(log_level));

    // Create the `ViewContextManager` and initialize it, then set it into the global
    let mut vcm = box ViewContextManager::default();
    vcm.init();
    unsafe { VIEW_CONTEXT_MANAGER = Box::into_raw(vcm) };
}

/// Creates a new view context from the provided name and sets it as the main view context.
#[wasm_bindgen]
pub fn create_view_context(vc_name: String) {
    let uuid = uuid_v4();
    let view_context = build_view(&vc_name, None, uuid);
    let vcm = get_vcm();
    let new_vc_ix = vcm.add_view_context(uuid_v4(), vc_name, view_context);
    vcm.set_active_view(new_vc_ix);
}

#[wasm_bindgen]
pub fn handle_window_close() {
    let vcm = get_vcm();
    vcm.get_active_view_mut().cleanup();
    vcm.save_all();
}

#[wasm_bindgen]
pub fn delete_vc_by_id(id: &str) {
    debug!("delete_vc_by_id(\"{}\")", id);
    let uuid = Uuid::from_str(id).expect("Invalid UUID string passed to `delete_vc_by_id`!");
    get_vcm().delete_vc_by_id(uuid);
}

#[wasm_bindgen]
pub fn switch_view_context(uuid_str: &str) {
    let uuid =
        Uuid::from_str(uuid_str).expect("Invalid UUID string passed to `switch_view_context`!");
    get_vcm().set_active_view_by_id(uuid);
}

#[wasm_bindgen]
pub fn reset_vcm() {
    info!("Resetting VCM...");
    get_vcm().reset();
    info!(
        "Finished reset; current context count: {}, active_ix: {}",
        get_vcm().contexts.len(),
        get_vcm().active_context_ix
    );
}

#[wasm_bindgen]
pub fn set_vc_title(uuid_str: String, title: String) {
    let uuid = Uuid::from_str(&uuid_str).expect("Invalid UUID string passed to `set_vc_title`!");
    let vc = get_vcm().get_vc_by_id_mut(uuid).unwrap_or_else(|| {
        panic!(
            "Attempted to set title of VC with ID {} but it wasn't found",
            uuid
        )
    });
    vc.definition.title = Some(title);
    get_vcm().commit();
}
