use dsp::{circular_buffer::CircularBuffer, FRAME_SIZE, SAMPLE_RATE};

use crate::fm::param_source::ParamSource;

use super::Effect;

pub const MAX_DELAY_SAMPLES: usize = SAMPLE_RATE as usize * 4;

#[derive(Clone)]
pub struct CombFilter {
  pub input_buffer: Box<CircularBuffer<MAX_DELAY_SAMPLES>>,
  pub feedback_buffer: Box<CircularBuffer<MAX_DELAY_SAMPLES>>,
  pub delay_samples: ParamSource,
  pub feedback_delay_samples: ParamSource,
  pub feedback_gain: ParamSource,
  pub feedforward_gain: ParamSource,
}

impl Effect for CombFilter {
  fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
    buf[0] = Some(&mut self.delay_samples);
    buf[1] = Some(&mut self.feedback_delay_samples);
    buf[2] = Some(&mut self.feedback_gain);
    buf[3] = Some(&mut self.feedforward_gain);
  }

  fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, input_sample: f32) -> f32 {
    let feedforward_delay_samples =
      dsp::clamp(0., MAX_DELAY_SAMPLES as f32 - 1., rendered_params[0]);
    let feedback_delay_samples = dsp::clamp(0., MAX_DELAY_SAMPLES as f32 - 1., rendered_params[1]);
    let feedback_gain = dsp::clamp(-1., 1., rendered_params[2]);
    let feedforward_gain = dsp::clamp(-1., 1., rendered_params[3]);

    // Feedforward: y[n] = x[n] + a * x[n - K]
    //
    // Feedback:    y[n] = x[n] + a * y[n - K]

    self.input_buffer.set(input_sample);

    let feedforward = feedforward_gain
      * self
        .input_buffer
        .read_interpolated(-feedforward_delay_samples);
    let feedback = feedback_gain
      * self
        .feedback_buffer
        .read_interpolated(-feedback_delay_samples);

    let output = input_sample + feedforward + feedback;
    self.feedback_buffer.set(output);
    output
  }

  fn apply_all(
    &mut self,
    rendered_params: &[[f32; FRAME_SIZE]],
    _base_frequencies: &[f32; FRAME_SIZE],
    samples: &mut [f32; FRAME_SIZE],
  ) {
    let feedforward_delay_samples = rendered_params[0];
    let feedback_delay_samples = rendered_params[1];
    let feedback_gain = rendered_params[2];
    let feedforward_gain = rendered_params[3];

    for sample_ix in 0..samples.len() {
      let delay_samples = dsp::clamp(
        0.,
        MAX_DELAY_SAMPLES as f32 - 1.,
        feedforward_delay_samples[sample_ix],
      );
      let feedback_delay_samples = dsp::clamp(
        0.,
        MAX_DELAY_SAMPLES as f32 - 1.,
        feedback_delay_samples[sample_ix],
      );
      let feedback_gain = dsp::clamp(-1., 1., feedback_gain[sample_ix]);
      let feedforward_gain = dsp::clamp(-1., 1., feedforward_gain[sample_ix]);

      // Feedforward: y[n] = x[n] + a * x[n - K]
      //
      // Feedback:    y[n] = x[n] + a * y[n - K]

      let input_sample = samples[sample_ix];
      self.input_buffer.set(input_sample);

      let feedforward = feedforward_gain * self.input_buffer.read_interpolated(-delay_samples);
      let feedback = feedback_gain
        * self
          .feedback_buffer
          .read_interpolated(-feedback_delay_samples);

      let output = input_sample + feedforward + feedback;
      self.feedback_buffer.set(output);
      samples[sample_ix] = output;
    }
  }

  fn reset(&mut self) {
    self.input_buffer.fill(0.);
    self.feedback_buffer.fill(0.);
  }
}
