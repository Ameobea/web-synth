use canvas_utils::VizView;

use self::{conf::FFT_BUFFER_SIZE, viz::LineSpectrumCtx};
use common::ref_static_mut;

pub(self) mod conf;
pub(crate) mod cubic_spline;
pub(self) mod viz;

extern "C" {
  fn log_err(ptr: *const u8, len: usize);
  fn log_info(ptr: *const u8, len: usize);
}

#[allow(dead_code)]
pub(self) fn log(msg: &str) {
  let bytes = msg.as_bytes();
  let len = bytes.len();
  let ptr = bytes.as_ptr();
  unsafe { log_info(ptr, len) }
}

static mut DID_SET_PANIC_HOOK: bool = false;

fn maybe_set_panic_hook() {
  unsafe {
    if DID_SET_PANIC_HOOK {
      return;
    }
    DID_SET_PANIC_HOOK = true;
  }

  let hook = move |info: &std::panic::PanicHookInfo| {
    let msg = format!("PANIC: {}", info.to_string());
    let bytes = msg.into_bytes();
    let len = bytes.len();
    let ptr = bytes.as_ptr();
    unsafe { log_err(ptr, len) }
  };

  std::panic::set_hook(Box::new(hook))
}

static mut CTX: LineSpectrumCtx = LineSpectrumCtx {
  view: VizView {
    dpr: 1,
    height: 0,
    width: 0,
  },
  frequency_data_buf: [0; FFT_BUFFER_SIZE],
  frequency_data_buf_f32: [0.; FFT_BUFFER_SIZE],
  image_data_buf: Vec::new(),
};

fn ctx() -> &'static mut LineSpectrumCtx { ref_static_mut!(CTX) }

#[no_mangle]
pub extern "C" fn line_spectrogram_set_view(width_px: usize, height_px: usize, dpr: usize) {
  maybe_set_panic_hook();

  ctx().set_view(VizView {
    width: width_px,
    height: height_px,
    dpr,
  });
}

#[no_mangle]
pub extern "C" fn line_spectrogram_get_frequency_data_ptr() -> *mut u8 {
  ctx().frequency_data_buf.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn line_spectrogram_get_image_data_ptr() -> *mut u8 {
  ctx().image_data_buf.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn line_spectrogram_process() { ctx().process(); }
