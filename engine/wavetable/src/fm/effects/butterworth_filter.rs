use dsp::filters::butterworth::ButterworthFilter as InnerButterworthFilter;

use crate::fm::{ParamSource, FRAME_SIZE};

use super::Effect;

#[derive(Clone, Copy)]
pub enum ButterworthFilterMode {
  Lowpass,
  Highpass,
  Bandpass,
}

impl From<usize> for ButterworthFilterMode {
  fn from(val: usize) -> Self {
    match val {
      0 => ButterworthFilterMode::Lowpass,
      1 => ButterworthFilterMode::Highpass,
      2 => ButterworthFilterMode::Bandpass,
      _ => panic!("Invalid butterworth filter mode: {}", val),
    }
  }
}

#[derive(Clone)]
pub struct ButterworthFilter {
  inner: InnerButterworthFilter,
  pub mode: ButterworthFilterMode,
  pub cutoff_freq: ParamSource,
}

impl ButterworthFilter {
  pub fn new(mode: ButterworthFilterMode, cutoff_freq: ParamSource) -> Self {
    ButterworthFilter {
      inner: InnerButterworthFilter::default(),
      mode,
      cutoff_freq,
    }
  }
}

impl Effect for ButterworthFilter {
  fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
    let cutoff_freq = unsafe { *rendered_params.get_unchecked(0) }.max(1.);
    match self.mode {
      ButterworthFilterMode::Lowpass => self.inner.lowpass(cutoff_freq, sample),
      ButterworthFilterMode::Highpass => self.inner.highpass(cutoff_freq, sample),
      ButterworthFilterMode::Bandpass => self.inner.bandpass(cutoff_freq, sample),
    }
  }

  fn apply_all(
    &mut self,
    rendered_params: &[[f32; FRAME_SIZE]],
    _base_frequencies: &[f32; FRAME_SIZE],
    samples: &mut [f32; FRAME_SIZE],
  ) {
    match self.mode {
      ButterworthFilterMode::Lowpass =>
        for sample_ix_within_frame in 0..FRAME_SIZE {
          let sample = unsafe { *samples.get_unchecked(sample_ix_within_frame) };
          let cutoff_freq = unsafe {
            *rendered_params
              .get_unchecked(0)
              .get_unchecked(sample_ix_within_frame)
          }
          .max(1.);
          unsafe {
            *samples.get_unchecked_mut(sample_ix_within_frame) =
              self.inner.lowpass(cutoff_freq, sample);
          }
        },
      ButterworthFilterMode::Highpass =>
        for sample_ix_within_frame in 0..FRAME_SIZE {
          let sample = unsafe { *samples.get_unchecked(sample_ix_within_frame) };
          let cutoff_freq = unsafe {
            *rendered_params
              .get_unchecked(0)
              .get_unchecked(sample_ix_within_frame)
          }
          .max(1.);
          unsafe {
            *samples.get_unchecked_mut(sample_ix_within_frame) =
              self.inner.highpass(cutoff_freq, sample);
          }
        },
      ButterworthFilterMode::Bandpass =>
        for sample_ix_within_frame in 0..FRAME_SIZE {
          let sample = unsafe { *samples.get_unchecked(sample_ix_within_frame) };
          let cutoff_freq = unsafe {
            *rendered_params
              .get_unchecked(0)
              .get_unchecked(sample_ix_within_frame)
          }
          .max(1.);
          unsafe {
            *samples.get_unchecked_mut(sample_ix_within_frame) =
              self.inner.bandpass(cutoff_freq, sample);
          }
        },
    }
  }

  fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
    buf[0] = Some(&mut self.cutoff_freq);
  }
}
