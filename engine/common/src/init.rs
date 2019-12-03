#[cfg(debug_assertions)]
use std::sync::Once;

#[cfg(debug_assertions)]
static ONCE: Once = Once::new();

// TODO: This needs to be moved into `common`
#[cfg(debug_assertions)]
pub fn maybe_init() {
    ONCE.call_once(|| {
        console_error_panic_hook::set_once();

        let log_level = if cfg!(debug_assertions) {
            log::Level::Trace
        } else {
            log::Level::Info
        };
        wasm_logger::init(wasm_logger::Config::new(log_level));
    });
}

#[cfg(not(debug_assertions))]
pub fn maybe_init() {}
