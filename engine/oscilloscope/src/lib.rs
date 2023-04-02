use self::oscilloscope::{PreviousWindow, Viz, VizView, WindowLength};
use f0_estimation::YinCtx;

pub(crate) mod conf;
pub(crate) mod f0_estimation;
pub(crate) mod oscilloscope;

extern "C" {
  fn log_err(ptr: *const u8, len: usize);
  fn log_info(ptr: *const u8, len: usize);
}

pub(crate) fn log(msg: &str) {
  let bytes = msg.as_bytes();
  let len = bytes.len();
  let ptr = bytes.as_ptr();
  unsafe { log_info(ptr, len) }
}

const FRAME_SIZE: usize = 128;

/// Used for receiving live samples from the audio thread
static mut FRAME_DATA_BUFFER: [f32; FRAME_SIZE] = [0.0; FRAME_SIZE];

static mut VIZ: Viz = Viz {
  samples: Vec::new(),
  window_length: WindowLength::Beats(1.),
  last_processed_sample_ix: 0,
  last_rendered_beat: 0.0,
  last_rendered_time: 0.0,
  image_data: Vec::new(),
  view: VizView {
    dpr: 1,
    height: 100,
    width: 100,
  },
  frozen: false,
  frame_by_frame: true,
  previous_windows: [
    PreviousWindow::new(),
    PreviousWindow::new(),
    PreviousWindow::new(),
    PreviousWindow::new(),
    PreviousWindow::new(),
    PreviousWindow::new(),
    PreviousWindow::new(),
    PreviousWindow::new(),
  ],
  frozen_window_complete: false,
  yin_ctx: YinCtx::new(),
};

fn maybe_set_panic_hook() {
  let hook = move |info: &std::panic::PanicInfo| {
    let msg = format!("PANIC: {}", info.to_string());
    let bytes = msg.into_bytes();
    let len = bytes.len();
    let ptr = bytes.as_ptr();
    unsafe { log_err(ptr, len) }
  };

  std::panic::set_hook(Box::new(hook))
}

#[no_mangle]
pub extern "C" fn oscilloscope_renderer_set_view(
  cur_bpm: f32,
  width: usize,
  height: usize,
  dpr: usize,
) {
  maybe_set_panic_hook();

  log(&format!(
    "oscilloscope_renderer_set_view: {}x{}@{}",
    width, height, dpr
  ));
  let viz = unsafe { &mut VIZ };
  viz.set_view(cur_bpm, VizView { width, height, dpr });
}

#[no_mangle]
pub extern "C" fn oscilloscope_renderer_set_window(window_mode: u8, window_length: f32) {
  let viz = unsafe { &mut VIZ };
  let window = WindowLength::from_parts(window_mode, window_length);
  viz.set_window(window);
}

/// Process all samples in `FRAME_DATA_BUFFER` and update the viz
#[no_mangle]
pub extern "C" fn oscilloscope_renderer_process(cur_bpm: f32, cur_beat: f32, cur_time: f32) {
  let viz = unsafe { &mut VIZ };
  viz.process(cur_bpm, cur_beat, cur_time);
}

#[no_mangle]
pub extern "C" fn oscilloscope_renderer_get_frame_data_ptr() -> *const f32 {
  unsafe { FRAME_DATA_BUFFER.as_ptr() }
}

#[no_mangle]
pub extern "C" fn oscilloscope_renderer_commit_samples() {
  let viz = unsafe { &mut VIZ };
  let frame_data = unsafe { &FRAME_DATA_BUFFER };
  viz.commit_samples(frame_data);
}

#[no_mangle]
pub extern "C" fn oscilloscope_get_image_data_buf_ptr() -> *const u8 {
  let viz = unsafe { &mut VIZ };
  viz.get_image_data().as_ptr()
}

#[no_mangle]
pub extern "C" fn oscilloscope_get_image_data_buf_len() -> usize {
  let viz = unsafe { &mut VIZ };
  viz.get_image_data().len()
}

#[no_mangle]
pub extern "C" fn oscilloscope_renderer_set_frozen(frozen: bool) {
  let viz = unsafe { &mut VIZ };
  viz.set_frozen(frozen);
}

#[no_mangle]
pub extern "C" fn oscilloscope_renderer_set_frame_by_frame(frame_by_frame: bool) {
  let viz = unsafe { &mut VIZ };
  viz.set_frame_by_frame(frame_by_frame);
}
