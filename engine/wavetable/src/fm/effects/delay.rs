use dsp::{circular_buffer::CircularBuffer, filters::dc_blocker::DCBlocker, SAMPLE_RATE};

use crate::fm::param_source::ParamSource;

use super::Effect;

pub const MAX_DELAY_SAMPLES: usize = SAMPLE_RATE as usize * 10;

#[derive(Clone)]
pub struct Delay {
  pub buffer: Box<CircularBuffer<MAX_DELAY_SAMPLES>>,
  pub delay_samples: ParamSource,
  pub wet: ParamSource,
  pub dry: ParamSource,
  pub feedback: ParamSource,
  pub dc_blocker: DCBlocker,
}

impl Effect for Delay {
  fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
    buf[0] = Some(&mut self.delay_samples);
    buf[1] = Some(&mut self.wet);
    buf[2] = Some(&mut self.dry);
    buf[3] = Some(&mut self.feedback);
  }

  fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
    let delay_samples = dsp::clamp(0., (MAX_DELAY_SAMPLES - 2) as f32, rendered_params[0]);
    let wet = dsp::clamp(0., 1., rendered_params[1]);
    let dry = dsp::clamp(0., 1., rendered_params[2]);
    let feedback = dsp::clamp(0., 1., rendered_params[3]);
    let delayed_sample = self.buffer.read_interpolated(-delay_samples);
    self.buffer.set(sample + (delayed_sample * feedback));

    let sample = (sample * dry) + (delayed_sample * wet);
    self.dc_blocker.apply(sample)
  }

  fn reset(&mut self) { self.buffer.fill(0.); }
}
