#[cfg(debug_assertions)]
static mut IS_INITIALIZED: bool = false;

#[cfg(debug_assertions)]
pub fn maybe_init() {
    if unsafe { IS_INITIALIZED } {
        return;
    }
    unsafe { IS_INITIALIZED = true };

    console_error_panic_hook::set_once();

    let log_level = log::Level::Trace;
    wasm_logger::init(wasm_logger::Config::new(log_level));
}

#[cfg(not(debug_assertions))]
pub fn maybe_init() {}
