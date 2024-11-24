static mut IS_INITIALIZED: bool = false;

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
}
