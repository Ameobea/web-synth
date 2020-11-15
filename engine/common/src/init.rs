use std::mem;

use rand::prelude::*;
use rand_pcg::Pcg32;
use wasm_bindgen::prelude::*;

use super::{rng, RNG};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = Math)]
    fn random() -> f64;
}

/// Initialize our PRNG with real(er) RNG from the browser
pub fn init_rng() {
    // Initialize the global PRNG
    unsafe {
        // slightly customized versions of the default seeds for the PCG32 PRNG, but seeded with
        // some actual RNG from JS so that things aren't deterministic.
        RNG = Box::into_raw(box Pcg32::new(
            if cfg!(target_arch = "wasm32") {
                mem::transmute(random())
            } else {
                0xcafef00dd15ea5e5
            },
            721_347_520_420_481_703,
        ))
    }

    // Pump it a few times because it seems to generate a fully null output the first time
    let _: usize = rng().gen();
    let _: usize = rng().gen();
}

static mut IS_INITIALIZED: bool = false;

#[cfg(debug_assertions)]
pub fn maybe_init() {
    if unsafe { IS_INITIALIZED } {
        return;
    }
    unsafe { IS_INITIALIZED = true };

    console_error_panic_hook::set_once();

    let log_level = if cfg!(debug_assertions) {
        log::Level::Trace
    } else {
        log::Level::Info
    };
    wasm_logger::init(wasm_logger::Config::new(log_level));

    init_rng();
}

#[cfg(not(debug_assertions))]
pub fn maybe_init() {
    if unsafe { IS_INITIALIZED } {
        return;
    }
    unsafe { IS_INITIALIZED = true };

    init_rng();
}
