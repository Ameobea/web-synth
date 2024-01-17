use std::f32::consts::PI;

use super::Effect;
use crate::fm::{ParamSource, SAMPLE_RATE};
use dsp::circular_buffer::CircularBuffer;

const MAX_CHORUS_DELAY_SAMPLES: usize = SAMPLE_RATE / 20; // 50ms
const NUM_TAPS: usize = 8;

const TWO_PI: f32 = PI * 2.;

#[derive(Clone)]
pub struct ChorusEffect {
  pub buffer: Box<CircularBuffer<MAX_CHORUS_DELAY_SAMPLES>>,
  pub modulation_depth: ParamSource,
  pub last_modulation_depth: f32,
  pub wet: ParamSource,
  pub last_wet: f32,
  pub dry: ParamSource,
  pub last_dry: f32,
  pub lfo_rate: ParamSource,
  pub last_lfo_rate: f32,
  pub lfo_phases: [f32; NUM_TAPS],
}

impl Effect for ChorusEffect {
  fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut crate::fm::ParamSource>; 4]) {
    buf[0] = Some(&mut self.modulation_depth);
    buf[1] = Some(&mut self.wet);
    buf[2] = Some(&mut self.dry);
    buf[3] = Some(&mut self.lfo_rate);
  }

  fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
    let depth = dsp::smooth(
      &mut self.last_modulation_depth,
      dsp::clamp(0., 1., unsafe { *rendered_params.get_unchecked(0) }),
      0.95,
    );
    let wet = dsp::smooth(
      &mut self.last_wet,
      dsp::clamp(0., 1., unsafe { *rendered_params.get_unchecked(1) }),
      0.95,
    );
    let dry = dsp::smooth(
      &mut self.last_dry,
      dsp::clamp(0., 1., unsafe { *rendered_params.get_unchecked(2) }),
      0.95,
    );
    let lfo_rate_hz = dsp::smooth(
      &mut self.last_lfo_rate,
      dsp::clamp(0., 20., unsafe { *rendered_params.get_unchecked(3) }),
      0.95,
    );

    // Update LFO phases
    for i in 0..NUM_TAPS {
      self.lfo_phases[i] += lfo_rate_hz / SAMPLE_RATE as f32;
      if self.lfo_phases[i] > TWO_PI {
        self.lfo_phases[i] -= TWO_PI;
      }
    }

    let mut chorus_sample = 0.0;
    for &phase in &self.lfo_phases {
      let lfo = phase.sin();
      // scale from [-1, 1] to [0, 1]
      let lfo = (lfo + 1.) / 2.;
      let delay_samples = (MAX_CHORUS_DELAY_SAMPLES as f32) * depth * lfo;
      chorus_sample += self.buffer.read_interpolated(-delay_samples);
    }

    chorus_sample /= NUM_TAPS as f32;
    self.buffer.set(sample);

    (sample * dry) + (chorus_sample * wet)
  }

  fn reset(&mut self) { self.buffer.fill(0.); }
}
