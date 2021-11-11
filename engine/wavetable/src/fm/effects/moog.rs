#![allow(non_snake_case)]
//! Code based off of this: https://github.com/ddiakopoulos/MoogLadders/blob/master/src/ImprovedModel.h

use std::f32::consts::PI;

use super::Effect;
use crate::fm::{ParamSource, FRAME_SIZE, SAMPLE_RATE};

// Thermal voltage (26 milliwats at room temperature)
const VT: f32 = 0.312;

#[derive(Clone)]
pub struct MoogFilter {
    V: [f32; 4],
    dV: [f32; 4],
    tV: [f32; 4],

    pub cutoff: ParamSource,
    pub resonance: ParamSource,
    pub drive: ParamSource,

    last_sample: f32,
}

impl MoogFilter {
    pub fn new(cutoff: ParamSource, resonance: ParamSource, drive: ParamSource) -> Self {
        MoogFilter {
            V: [0.0; 4],
            dV: [0.0; 4],
            tV: [0.0; 4],

            cutoff,
            resonance,
            drive,
            last_sample: 0.,
        }
    }
}

fn tanh(x: f32) -> f32 { fastapprox::fast::tanh(x) }

impl Effect for MoogFilter {
    fn apply(&mut self, rendered_params: &[f32], base_frequency: f32, sample: f32) -> f32 {
        todo!()
    }

    fn apply_all(
        &mut self,
        rendered_params: &[[f32; FRAME_SIZE]],
        _base_frequencies: &[f32; FRAME_SIZE],
        samples: &mut [f32; FRAME_SIZE],
    ) {
        let mut dV0;
        let mut dV1;
        let mut dV2;
        let mut dV3;

        // Param orderings:
        // [cutoff, resonance, drive]
        let cutoffs = &rendered_params[0];
        let resonances = &rendered_params[1];
        let drives = &rendered_params[2];

        let mut last_sample = self.last_sample;
        for i in 0..samples.len() {
            let mut out_sample = 0.;

            if i > 0 {
                last_sample = samples[i - 1];
            }

            // 2x oversampling
            for j in 0..=1 {
                let sample = if j == 0 {
                    dsp::mix(0.5, last_sample, samples[i])
                } else {
                    samples[i]
                };

                let cutoff = dsp::clamp(1., 22_100., cutoffs[i]);
                let resonance = dsp::clamp(0., 20., resonances[i]);
                let drive = drives[i];

                let x = (PI * cutoff) / SAMPLE_RATE as f32;
                let g = 4. * PI * VT * cutoff * (1. - x) / (1. + x);

                dV0 =
                    -g * (tanh((drive * sample + resonance * self.V[3]) / (2.0 * VT)) + self.tV[0]);
                self.V[0] += (dV0 + self.dV[0]) / (2.0 * SAMPLE_RATE as f32);
                self.dV[0] = dV0;
                self.tV[0] = tanh(self.V[0] / (2.0 * VT));

                dV1 = g * (self.tV[0] - self.tV[1]);
                self.V[1] += (dV1 + self.dV[1]) / (2.0 * SAMPLE_RATE as f32);
                self.dV[1] = dV1;
                self.tV[1] = tanh(self.V[1] / (2.0 * VT));

                dV2 = g * (self.tV[1] - self.tV[2]);
                self.V[2] += (dV2 + self.dV[2]) / (2.0 * SAMPLE_RATE as f32);
                self.dV[2] = dV2;
                self.tV[2] = tanh(self.V[2] / (2.0 * VT));

                dV3 = g * (self.tV[2] - self.tV[3]);
                self.V[3] += (dV3 + self.dV[3]) / (2.0 * SAMPLE_RATE as f32);
                self.dV[3] = dV3;
                self.tV[3] = tanh(self.V[3] / (2.0 * VT));

                out_sample += self.V[3];
            }

            samples[i] = out_sample / 2.;
        }
        self.last_sample = last_sample;
    }

    fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
        buf[0] = Some(&mut self.cutoff);
        buf[1] = Some(&mut self.resonance);
        buf[2] = Some(&mut self.drive);
    }
}
