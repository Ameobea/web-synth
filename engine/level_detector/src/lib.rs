use dsp::{rms_level_detector::RMSLevelDetector, FRAME_SIZE};

extern "C" {
  fn log_err(ptr: *const u8, len: usize);
}

pub struct LevelDetectorCtx {
  pub io_buffer: [f32; FRAME_SIZE],
  pub detector: RMSLevelDetector<true>,
}

impl Default for LevelDetectorCtx {
  fn default() -> Self {
    Self {
      io_buffer: [0.0; FRAME_SIZE],
      detector: RMSLevelDetector::new(10), // Window size will be set dynamically during processing
    }
  }
}

impl LevelDetectorCtx {
  pub fn process(&mut self, window_size_samples: usize) {
    self.detector.set_window_size_samples(window_size_samples);
    for sample in &mut self.io_buffer {
      *sample = self.detector.process(*sample);
    }
  }
}

#[no_mangle]
pub extern "C" fn level_detector_create_ctx() -> *mut LevelDetectorCtx {
  common::set_raw_panic_hook(log_err);

  let ctx = LevelDetectorCtx::default();
  Box::into_raw(Box::new(ctx))
}

#[no_mangle]
pub extern "C" fn level_detector_get_io_buf_ptr(ctx: *mut LevelDetectorCtx) -> *mut f32 {
  let ctx = unsafe { &mut *ctx };
  ctx.io_buffer.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn level_detector_process(ctx: *mut LevelDetectorCtx, window_size_samples: usize) {
  let ctx = unsafe { &mut *ctx };
  ctx.process(window_size_samples);
}
