use std::f32::consts::PI;

use crate::{linear_to_db_checked, NYQUIST};

/// Second-order biquad filter
#[derive(Clone, Copy, Default)]
pub struct BiquadFilter {
    pub a0: f32,
    pub a1: f32,
    pub a2: f32,
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub b0_over_a0: f32,
    pub b1_over_a0: f32,
    pub b2_over_a0: f32,
    pub a1_over_a0: f32,
    pub a2_over_a0: f32,
    pub x: [f32; 2],
    pub y: [f32; 2],
}

pub enum FilterMode {
    Lowpass,
    Highpass,
    Bandpass,
    Notch,
    Peak,
    Lowshelf,
    Highshelf,
}

impl BiquadFilter {
    #[inline]
    pub fn set_coefficients(
        &mut self,
        mode: FilterMode,
        q: f32,
        detune: f32,
        freq: f32,
        gain: f32,
    ) {
        // From: https://webaudio.github.io/web-audio-api/#filters-characteristics
        let computed_frequency = freq * 2.0f32.powf(detune / 1200.0);
        let normalized_freq = computed_frequency / NYQUIST;
        let w0 = PI * normalized_freq;
        let A = 10.0_f32.powf(gain / 40.0);
        let aq = w0.sin() / (2.0 * q);
        let aqdb = w0.sin() / (2.0 * 10.0f32.powf(q / 20.));
        let S = 1.;
        let a_s = (w0.sin() / 2.) * ((A + (1. / A)) * ((1. / S) - 1.) + 2.).sqrt();

        match mode {
            FilterMode::Lowpass => {
                self.b0 = (1. - w0.cos()) / 2.;
                self.b1 = 1. - w0.cos();
                self.b2 = (1. - w0.cos()) / 2.;
                self.a0 = 1. + aqdb;
                self.a1 = -2. * w0.cos();
                self.a2 = 1. - aqdb;
            },
            FilterMode::Highpass => {
                self.b0 = (1. + w0.cos()) / 2.;
                self.b1 = -(1. + w0.cos());
                self.b2 = (1. + w0.cos()) / 2.;
                self.a0 = 1. + aqdb;
                self.a1 = -2. * w0.cos();
                self.a2 = 1. - aqdb;
            },
            FilterMode::Bandpass => {
                self.b0 = aq;
                self.b1 = 0.;
                self.b2 = -aq;
                self.a0 = 1. + aq;
                self.a1 = -2. * w0.cos();
                self.a2 = 1. - aq;
            },
            FilterMode::Notch => {
                self.b0 = 1.;
                self.b1 = -2. * w0.cos();
                self.b2 = 1.;
                self.a0 = 1. + aq;
                self.a1 = -2. * w0.cos();
                self.a2 = 1. - aq;
            },
            FilterMode::Peak => {
                self.b0 = 1. + aq * A;
                self.b1 = -2. * w0.cos();
                self.b2 = 1. - aq * A;
                self.a0 = 1. + aq / A;
                self.a1 = -2. * w0.cos();
                self.a2 = 1. - aq / A;
            },
            FilterMode::Lowshelf => {
                self.b0 = A * ((A + 1.) - (A - 1.) * w0.cos() + 2. * a_s * A.sqrt());
                self.b1 = 2. * A * ((A - 1.) - (A + 1.) * w0.cos());
                self.b2 = A * ((A + 1.) - (A - 1.) * w0.cos() - 2. * a_s * A.sqrt());
                self.a0 = (A + 1.) + (A - 1.) * w0.cos() + 2. * a_s * A.sqrt();
                self.a1 = -2. * ((A - 1.) + (A + 1.) * w0.cos());
                self.a2 = (A + 1.) + (A - 1.) * w0.cos() - 2. * a_s * A.sqrt();
            },
            FilterMode::Highshelf => {
                self.b0 = A * ((A + 1.) + (A - 1.) * w0.cos() + 2. * a_s * A.sqrt());
                self.b1 = -2. * A * ((A - 1.) + (A + 1.) * w0.cos());
                self.b2 = A * ((A + 1.) + (A - 1.) * w0.cos() - 2. * a_s * A.sqrt());
                self.a0 = (A + 1.) - (A - 1.) * w0.cos() + 2. * a_s * A.sqrt();
                self.a1 = 2. * ((A - 1.) - (A + 1.) * w0.cos());
                self.a2 = (A + 1.) - (A - 1.) * w0.cos() - 2. * a_s * A.sqrt();
            },
        }

        self.b0_over_a0 = self.b0 / self.a0;
        self.b1_over_a0 = self.b1 / self.a0;
        self.b2_over_a0 = self.b2 / self.a0;
        self.a1_over_a0 = self.a1 / self.a0;
        self.a2_over_a0 = self.a2 / self.a0;
    }

    #[inline]
    pub fn new(mode: FilterMode, q: f32, detune: f32, freq: f32, gain: f32) -> BiquadFilter {
        let mut filter = BiquadFilter::default();
        filter.set_coefficients(mode, q, detune, freq, gain);
        filter
    }

    #[inline]
    pub fn apply(&mut self, input: f32) -> f32 {
        let output =
            self.b0_over_a0 * input + self.b1_over_a0 * self.x[0] + self.b2_over_a0 * self.x[1]
                - self.a1_over_a0 * self.y[0]
                - self.a2_over_a0 * self.y[1];

        self.x = [input, self.x[0]];
        self.y = [output, self.y[0]];

        output
    }
}

/// higher-order filter Q factors determined using this: https://www.earlevel.com/main/2016/09/29/cascading-filters/
#[inline]
pub fn compute_higher_order_biquad_q_factors(order: usize) -> Vec<f32> {
    if order % 2 != 0 || order <= 0 {
        panic!("order must be even and greater than 0");
    }

    (0..order / 2)
        .map(|i| {
            linear_to_db_checked(
                1. / (2. * (PI / order as f32 / 2. + (PI / order as f32) * i as f32).cos()),
            )
        })
        .collect()
}
