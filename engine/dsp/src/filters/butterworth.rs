use crate::SAMPLE_RATE;

#[derive(Clone, Copy, Default)]
pub struct ButterworthFilter {
  /// Holds the last 2 samples of input with index 0 being 2 samples ago and index 1 being 1
  /// sample ago
  delayed_inputs: [f32; 2],
  /// Holds the last 2 samples of output with index 0 being 2 samples ago and index 1 being 1
  /// sample ago
  delayed_outputs: [f32; 2],
  last_cutoff_freq: f32,
}

impl ButterworthFilter {
  #[inline]
  fn get_output(
    &self,
    amp_in0: f32,
    amp_in1: f32,
    amp_in2: f32,
    amp_out1: f32,
    amp_out2: f32,
    input: f32,
  ) -> f32 {
    (amp_in0 * input) + (amp_in1 * self.delayed_inputs[1]) + (amp_in2 * self.delayed_inputs[0])
      - (amp_out1 * self.delayed_outputs[1])
      - (amp_out2 * self.delayed_outputs[0])
  }

  #[inline]
  fn update_state(&mut self, input: f32, output: f32) {
    self.delayed_outputs[0] = self.delayed_outputs[1];
    self.delayed_outputs[1] = output;
    self.delayed_inputs[0] = self.delayed_inputs[1];
    self.delayed_inputs[1] = input;
  }

  // Adapted from code at the bottom of this page: http://basicsynth.com/index.php?page=filters
  #[inline]
  pub fn lowpass(&mut self, cutoff_freq: f32, input: f32) -> f32 {
    let cutoff_freq = crate::smooth(
      &mut self.last_cutoff_freq,
      crate::clamp_normalize(1., 18_000., cutoff_freq),
      0.99,
    );
    let c = 1. / ((std::f32::consts::PI / SAMPLE_RATE) * cutoff_freq).tan();
    let c2 = c * c;
    let csqr2 = std::f32::consts::SQRT_2 * c;
    let d = c2 + csqr2 + 1.;
    let amp_in0 = 1. / d;
    let amp_in1 = amp_in0 + amp_in0;
    let amp_in2 = amp_in0;
    let amp_out1 = (2. * (1. - c2)) / d;
    let amp_out2 = (c2 - csqr2 + 1.0) / d;

    let output = self.get_output(amp_in0, amp_in1, amp_in2, amp_out1, amp_out2, input);
    debug_assert!(output.is_normal());
    debug_assert!(output > -2.);
    debug_assert!(output < 2.);
    self.update_state(input, output);
    output
  }

  #[inline]
  pub fn highpass(&mut self, cutoff_freq: f32, input: f32) -> f32 {
    let cutoff_freq = crate::smooth(
      &mut self.last_cutoff_freq,
      crate::clamp_normalize(1., 18_000., cutoff_freq),
      0.99,
    );
    let mut c = ((std::f32::consts::PI / SAMPLE_RATE) * cutoff_freq).tan();
    if c.abs() < 0.002 {
      c = c.signum() * 0.002;
    }
    let c2 = c * c;
    let csqr2 = std::f32::consts::SQRT_2 * c;
    let d = c2 + csqr2 + 1.;
    let amp_in0 = 1. / d;
    debug_assert!(d.is_normal());
    let amp_in1 = -(amp_in0 + amp_in0);
    let amp_in2 = amp_in0;
    let amp_out1 = (2. * (c2 - 1.)) / d;
    let amp_out2 = (1. - csqr2 + c2) / d;

    let output = self.get_output(amp_in0, amp_in1, amp_in2, amp_out1, amp_out2, input);
    debug_assert!(output.is_normal());
    debug_assert!(output > -5.);
    debug_assert!(output < 5.);
    self.update_state(input, output);
    output
  }

  #[inline]
  pub fn bandpass(&mut self, cutoff_freq: f32, input: f32) -> f32 {
    let cutoff_freq = crate::smooth(
      &mut self.last_cutoff_freq,
      crate::clamp_normalize(1., 18_000., cutoff_freq),
      0.99,
    );
    let c = 1. / ((std::f32::consts::PI / SAMPLE_RATE) * cutoff_freq).tan();
    let d = 1. + c;
    let amp_in0 = 1. / d;
    let amp_in1 = 0.;
    let amp_in2 = -amp_in0;
    let amp_out1 =
            // TODO: Verify that this is correct; it was `cutoffFreq/sr` and idk what sr is but
            // I can't think of anything else
            (-c * 2. * (std::f32::consts::PI * 2. * cutoff_freq / SAMPLE_RATE).cos()) / d;
    let amp_out2 = (c - 1.) / d;

    let output = self.get_output(amp_in0, amp_in1, amp_in2, amp_out1, amp_out2, input);
    debug_assert!(output.is_normal());
    debug_assert!(output > -2.);
    debug_assert!(output < 2.);
    self.update_state(input, output);
    output
  }
}
