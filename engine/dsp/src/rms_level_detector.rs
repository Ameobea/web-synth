use crate::circular_buffer::CircularBuffer;

pub const MAX_LEVEL_DETECTION_WINDOW_SAMPLES: usize = crate::SAMPLE_RATE as usize;

pub struct RMSLevelDetector<const TEND_TOWARDS_ZERO: bool> {
  pub buf: CircularBuffer<MAX_LEVEL_DETECTION_WINDOW_SAMPLES>,
  pub sum: f32,
  pub negative_window_size_samples: isize,
  pub window_size_samples_f32: f32,
}

impl<const TEND_TOWARDS_ZERO: bool> RMSLevelDetector<TEND_TOWARDS_ZERO> {
  pub const fn new(window_size_samples: usize) -> Self {
    RMSLevelDetector {
      buf: CircularBuffer::new(),
      sum: 0.,
      negative_window_size_samples: -((window_size_samples) as isize),
      window_size_samples_f32: window_size_samples as f32,
    }
  }

  /// RMS level detection
  pub fn process(&mut self, sample: f32) -> f32 {
    if cfg!(debug_assertions) && (sample.is_infinite() || sample.is_nan()) {
      panic!("{}", sample);
    }
    let removed_squared_sample = self.buf.get(self.negative_window_size_samples);
    self.sum -= removed_squared_sample;
    let squared_sample = sample * sample;
    self.sum = (self.sum + squared_sample).max(0.);
    self.buf.set(squared_sample);

    let output = (self.sum / self.window_size_samples_f32).sqrt();
    if cfg!(debug_assertions) && (output.is_infinite() || output.is_nan()) {
      panic!(
        "out={output}, sum={sum}, sample={sample}, removed={removed_squared_sample}",
        sum = self.sum
      );
    }

    // To deal with floating point precision issues, we tend the sum towards zero slightly so
    // that it doesn't get stuck at a non-zero value when the input is silent.
    if TEND_TOWARDS_ZERO && sample.abs() < 0.001 {
      self.sum *= 0.999999;
    }

    output
  }

  pub fn set_window_size_samples(&mut self, new_window_size_samples: usize) {
    self.negative_window_size_samples = -(new_window_size_samples as isize);
    self.window_size_samples_f32 = new_window_size_samples as f32;
  }
}
