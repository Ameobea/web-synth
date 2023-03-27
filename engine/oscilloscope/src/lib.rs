use oscilloscope::{Viz, WindowLength};

pub mod oscilloscope;

const FRAME_SIZE: usize = 128;

/// Used for receiving live samples from the audio thread
static mut FRAME_DATA_BUFFER: [f32; FRAME_SIZE] = [0.0; FRAME_SIZE];

static mut VIZ: Viz = Viz {
  samples: Vec::new(),
  window_length: WindowLength::Seconds(5.0),
  last_processed_sample_ix: 0,
  last_rendered_beat: 0.0,
  last_rendered_time: 0.0,
  // TODO
};

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
