use dsp::filters::biquad::{BiquadFilter, FilterMode};

use crate::fm::ParamSource;

use super::Effect;

#[derive(Clone)]
pub struct BiquadFilterEffect {
  pub inner: BiquadFilter,
  pub mode: FilterMode,
  pub cutoff_freq: ParamSource,
  pub q: ParamSource,
  pub gain: ParamSource,
}

impl Effect for BiquadFilterEffect {
  fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; super::MAX_PARAM_COUNT]) {
    buf[0] = Some(&mut self.cutoff_freq);
    buf[1] = Some(&mut self.q);
    buf[2] = Some(&mut self.gain);
  }

  fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
    let cutoff_freq = unsafe { *rendered_params.get_unchecked(0) };
    let q = unsafe { *rendered_params.get_unchecked(1) };
    let gain = unsafe { *rendered_params.get_unchecked(2) };

    self
      .inner
      .compute_coefficients_and_apply(self.mode, q, cutoff_freq, gain, sample)
  }
}
