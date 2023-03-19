use dsp::circular_buffer::CircularBuffer;

pub const FRAME_SIZE: usize = 128;
// const CIRCULAR_BUFFER_SIZE:usize = 16777216;
const CIRCULAR_BUFFER_SIZE: usize = 10000;

pub struct WaveStretcher {
  pub cur_index: usize,
  pub io_sample_buffer: [f32; FRAME_SIZE],
  // 32MB circular buffer supporting lookback/delay required to implement this as a rolling thing
  internal_sample_buffer: CircularBuffer<CIRCULAR_BUFFER_SIZE>,
  pub param_buffer: [f32; FRAME_SIZE],
  pub len_samples: usize,
}

// static mut WAVE_STRETCHER: WaveStretcher = WaveStretcher {
//     cur_index: 0,
//     io_sample_buffer: [0.0f32; FRAME_SIZE],
//     internal_sample_buffer: CircularBuffer::new(),
//     param_buffer: [0.0f32; FRAME_SIZE],
//     len_samples: 812,
// };

impl WaveStretcher {
  pub fn new(len_samples: usize) -> Self {
    WaveStretcher {
      cur_index: 0,
      io_sample_buffer: [0.0f32; FRAME_SIZE],
      internal_sample_buffer: CircularBuffer::new(),
      param_buffer: [0.0f32; FRAME_SIZE],
      len_samples,
    }
  }

  /// This is the meat of the wavestretcher right here; we move through the waveform at different
  /// rates over the course of the frame.
  ///
  /// `stretch_factor` should be between 0 and 1 inclusive.
  ///
  /// We have to be sure that the function always returns values between 0 and `len_samples`.
  ///
  /// Credit to https://www.linkedin.com/in/cameron-mcferran-hall/ for coming up with the
  /// equation used to produce this algorithm
  fn get_transformed_index(&self, sample_ix: usize, stretch_factor: f32) -> f32 {
    let exponent_numerator = 10.0f32.powf(4.0 * (stretch_factor * 0.8 + 0.35)) + 1.;
    let exponent_denominator = 999.0f32;
    let exponent = exponent_numerator / exponent_denominator;

    // Transform index into [-1, 1] range
    let continuous_index = ((sample_ix as f32) / (self.len_samples as f32)) * 2. - 1.;
    let positive_index = continuous_index.abs();
    // val is from 0 to 1
    let val = positive_index.powf(exponent);
    // output is from 0 to 1
    (val * continuous_index.signum()) / 2. + 0.5
  }

  /// Both params should be between 0.0 and 1.0 inclusive
  fn read_delayed_sample(
    &self,
    base_continuous_sample_ix: f32,
    transformed_continuous_sample_ix: f32,
  ) -> f32 {
    // `diff` is between -1.0 and 1.0 inclusive
    let diff = transformed_continuous_sample_ix - base_continuous_sample_ix;

    let half_length_samples = self.len_samples as f32 / 2.;
    let sample_ix = (-half_length_samples + diff * half_length_samples).min(0.);
    // assert!(sample_ix < 0.);
    self.internal_sample_buffer.read_interpolated(sample_ix)
  }

  fn process_sample(&mut self, sample_ix_in_frame: usize) {
    self.cur_index += 1;
    let cur_index = self.cur_index;
    // At this point, `cur_ix <= self.len_samples`

    let sample = self.io_sample_buffer[sample_ix_in_frame];
    self.internal_sample_buffer.set(sample);

    let stretch_factor = self.param_buffer[sample_ix_in_frame];
    let base_ix = (cur_index as f32) / (self.len_samples as f32);
    let transformed_ix = self.get_transformed_index(cur_index, stretch_factor);
    let output_sample = self.read_delayed_sample(base_ix, transformed_ix);
    self.io_sample_buffer[sample_ix_in_frame] = output_sample;

    if self.cur_index >= self.len_samples {
      self.cur_index = 0;
    }
  }

  pub fn process(&mut self) {
    for sample_ix_in_frame in 0..FRAME_SIZE {
      self.process_sample(sample_ix_in_frame);
    }
  }
}

#[no_mangle]
pub unsafe extern "C" fn distortion_init_ctx(len_samples: usize) -> *mut WaveStretcher {
  Box::into_raw(Box::new(WaveStretcher::new(len_samples)))
}

#[no_mangle]
pub unsafe extern "C" fn distortion_get_sample_buffer_ptr(ctx: *mut WaveStretcher) -> *mut f32 {
  (*ctx).io_sample_buffer.as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn distortion_get_param_buffer_pr(ctx: *mut WaveStretcher) -> *mut f32 {
  (*ctx).param_buffer.as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn distortion_set_length_samples(
  ctx: *mut WaveStretcher,
  new_len_samples: usize,
) {
  (*ctx).len_samples = new_len_samples;
}

#[no_mangle]
pub unsafe extern "C" fn distortion_process(ctx: *mut WaveStretcher) { (*ctx).process() }
