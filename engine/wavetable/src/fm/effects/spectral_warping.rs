use dsp::circular_buffer::CircularBuffer;

use super::Effect;
use crate::fm::{ExponentialOscillator, ParamSource, SAMPLE_RATE};

pub const SPECTRAL_WARPING_BUFFER_SIZE: usize = 44100 * 2;

pub struct SpectralWarpingParams {
  pub warp_factor: ParamSource,
  pub frequency: ParamSource,
}

#[derive(Clone)]
pub struct SpectralWarping {
  pub frequency: ParamSource,
  pub buffer: Box<CircularBuffer<SPECTRAL_WARPING_BUFFER_SIZE>>,
  pub osc: ExponentialOscillator,
}

impl SpectralWarping {
  pub fn new(
    SpectralWarpingParams {
      warp_factor,
      frequency,
    }: SpectralWarpingParams,
  ) -> Self {
    SpectralWarping {
      frequency,
      buffer: Box::new(CircularBuffer::new()),
      osc: ExponentialOscillator::new(warp_factor),
    }
  }

  fn get_phase_warp_diff(&mut self, frequency: f32, stretch_factor: f32) -> f32 {
    let osc_output = self
      .osc
      .gen_sample_with_stretch_factor(frequency, stretch_factor);
    let warped_phase = (osc_output + 1.) / 2.;
    debug_assert!(warped_phase >= 0.);
    debug_assert!(warped_phase <= 1.);
    debug_assert!(self.osc.phase >= 0.);
    debug_assert!(self.osc.phase <= 1.);
    warped_phase - self.osc.phase
  }
}

impl Effect for SpectralWarping {
  fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
    self.buffer.set(sample);
    let frequency = unsafe { *rendered_params.get_unchecked(0) };
    let stretch_factor = unsafe { *rendered_params.get_unchecked(1) };
    // We look back half of the wavelength of the frequency.
    let base_lookback_samples = ((SAMPLE_RATE as f32) / frequency) / 2.;
    if !base_lookback_samples.is_normal() {
      return sample;
    }

    // We then "warp" the position of the read head according to the warp factor.
    let phase_warp_diff = self.get_phase_warp_diff(frequency, stretch_factor);
    debug_assert!(phase_warp_diff >= -1.);
    debug_assert!(phase_warp_diff <= 1.);
    let lookback_samples = base_lookback_samples + (base_lookback_samples * phase_warp_diff);
    debug_assert!(lookback_samples >= 0.);

    self.buffer.read_interpolated(-lookback_samples)
  }

  fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
    buf[0] = Some(&mut self.frequency);
    buf[1] = Some(&mut self.osc.stretch_factor);
  }
}
