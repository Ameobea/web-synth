#![feature(min_const_generics)]

pub mod circular_buffer;

/// For `coefficient` values between 0 and 1, applies smoothing to a value, interpolating between
/// previous values and new values.  Values closer to 1 applier heavier smoothing.
///
/// This works as a filter for audio in the same vein as `y(n) = x(n) + x(n - 1)` where `state` is
/// `x(n - 1)` and `new_val` is `x(n)`.  It can be made to function as either a lowpass or highpass
/// filter depending on the value of `coefficient`.
///
/// Based off of https://github.com/pichenettes/stmlib/blob/master/dsp/dsp.h#L77
pub fn one_pole(state: &mut f32, new_val: f32, coefficient: f32) {
    *state += coefficient * (new_val - *state)
}

/// Low pass filter that smooths changes in a signal.  This is helpful to avoid audio artifacts that
/// are caused by input parameters jumping quickly between values.
///
/// `smooth_factor` determines the amount of smoothing that is applied.  The closer to 1.0 you get,
/// the smoother it is.
pub fn smooth(state: &mut f32, new_val: f32, smooth_factor: f32) {
    *state = smooth_factor * *state + (1. - smooth_factor) * new_val;
}

pub fn clamp(min: f32, max: f32, val: f32) -> f32 { val.max(min).min(max) }

pub fn mix(v1_pct: f32, v1: f32, v2: f32) -> f32 { (v1_pct * v1) + (1. - v1_pct) * v2 }

pub fn read_interpolated(buf: &[f32], index: f32) -> f32 {
    let base_ix = index.trunc() as usize;
    let next_ix = base_ix + 1;
    mix(index.fract(), buf[next_ix], buf[base_ix])
}

#[derive(Clone, Copy)]
pub struct ButterworthFilter {
    pub sample_rate: f32,
    /// Holds the last 2 samples of input with index 0 being 2 samples ago and index 1 being 1
    /// sample ago
    delayed_inputs: [f32; 2],
    /// Holds the last 2 samples of output with index 0 being 2 samples ago and index 1 being 1
    /// sample ago
    delayed_outputs: [f32; 2],
}

impl ButterworthFilter {
    pub fn new(sample_rate: usize) -> Self {
        ButterworthFilter {
            sample_rate: sample_rate as f32,
            delayed_inputs: [0., 0.],
            delayed_outputs: [0., 0.],
        }
    }

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

    fn update_state(&mut self, input: f32, output: f32) {
        self.delayed_outputs[0] = self.delayed_outputs[1];
        self.delayed_outputs[1] = output;
        self.delayed_inputs[0] = self.delayed_inputs[1];
        self.delayed_inputs[1] = input;
    }

    // Adapted from code at the bottom of this page: http://basicsynth.com/index.php?page=filters
    pub fn lowpass(&mut self, cutoff_freq: f32, input: f32) -> f32 {
        let c = 1. / ((std::f32::consts::PI / self.sample_rate as f32) * cutoff_freq).tan();
        let c2 = c * c;
        let csqr2 = std::f32::consts::SQRT_2 * c;
        let d = c2 + csqr2 + 1.;
        let amp_in0 = 1. / d;
        let amp_in1 = amp_in0 + amp_in0;
        let amp_in2 = amp_in0;
        let amp_out1 = (2. * (1. - c2)) / d;
        let amp_out2 = (c2 - csqr2 + 1.0) / d;

        let output = self.get_output(amp_in0, amp_in1, amp_in2, amp_out1, amp_out2, input);
        self.update_state(input, output);
        output
    }

    pub fn highpass(&mut self, cutoff_freq: f32, input: f32) -> f32 {
        let c = ((std::f32::consts::PI / self.sample_rate) * cutoff_freq).tan();
        let c2 = c * c;
        let csqr2 = std::f32::consts::SQRT_2 * c;
        let d = c2 + csqr2 + 1.;
        let amp_in0 = 1. / d;
        let amp_in1 = -(amp_in0 + amp_in0);
        let amp_in2 = amp_in0;
        let amp_out1 = (2. * (c2 - 1.)) / d;
        let amp_out2 = (1. - csqr2 + c2) / d;

        let output = self.get_output(amp_in0, amp_in1, amp_in2, amp_out1, amp_out2, input);
        self.update_state(input, output);
        output
    }

    pub fn bandpass(&mut self, cutoff_freq: f32, input: f32) -> f32 {
        let c = 1. / ((std::f32::consts::PI / self.sample_rate) * cutoff_freq).tan();
        let d = 1. + c;
        let amp_in0 = 1. / d;
        let amp_in1 = 0.;
        let amp_in2 = -amp_in0;
        let amp_out1 =
            // TODO: Verify that this is correct; it was `cutoffFreq/sr` and idk what sr is but
            // I can't think of anything else
            (-c * 2. * (std::f32::consts::PI * 2. * cutoff_freq / self.sample_rate).cos()) / d;
        let amp_out2 = (c - 1.) / d;

        let output = self.get_output(amp_in0, amp_in1, amp_in2, amp_out1, amp_out2, input);
        self.update_state(input, output);
        output
    }
}
