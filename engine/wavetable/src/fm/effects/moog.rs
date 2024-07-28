#![allow(non_snake_case)]
//! Code based off of this: https://github.com/ddiakopoulos/MoogLadders/blob/master/src/ImprovedModel.h
//
// Original license:
/*
Copyright 2012 Stefano D'Angelo <zanga.mail@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THIS SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
*/

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
  fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
    let cutoff = unsafe { *rendered_params.get_unchecked(0) };
    let resonance = unsafe { *rendered_params.get_unchecked(1) };
    let drive = unsafe { *rendered_params.get_unchecked(2) };

    let [mut dV0, mut dV1, mut dV2, mut dV3] = self.dV;
    let [mut tV0, mut tV1, mut tV2, mut tV3] = self.tV;
    let [mut V0, mut V1, mut V2, mut V3] = self.V;

    let mut out_sample = 0.;
    // 2x oversampling
    for j in 0..=1 {
      let sample = if j == 0 {
        dsp::mix(0.5, self.last_sample, sample)
      } else {
        sample
      };

      let cutoff = dsp::clamp(1., 22_100., cutoff);
      let resonance = dsp::clamp(0., 20., resonance);

      let x = (PI * cutoff) / (SAMPLE_RATE * 2) as f32;
      let g = 4. * PI * VT * cutoff * (1. - x) / (1. + x);

      let new_dV0 = -g * (tanh((drive * sample + resonance * V3) / (2. * VT)) + tV0);
      V0 += (new_dV0 + dV0) / (2. * (SAMPLE_RATE * 2) as f32);
      dV0 = new_dV0;
      tV0 = tanh(V0 / (2. * VT));

      let new_dV1 = g * (tV0 - tV1);
      V1 += (new_dV1 + dV1) / (2. * (SAMPLE_RATE * 2) as f32);
      dV1 = new_dV1;
      tV1 = tanh(V1 / (2. * VT));

      let new_dV2 = g * (tV1 - tV2);
      V2 += (new_dV2 + dV2) / (2. * (SAMPLE_RATE * 2) as f32);
      dV2 = new_dV2;
      tV2 = tanh(V2 / (2. * VT));

      let new_dV3 = g * (tV2 - tV3);
      V3 += (new_dV3 + dV3) / (2. * (SAMPLE_RATE * 2) as f32);
      dV3 = new_dV3;
      tV3 = tanh(V3 / (2. * VT));

      out_sample += V3;
    }
    self.last_sample = sample;

    self.tV = [tV0, tV1, tV2, tV3];
    self.dV = [dV0, dV1, dV2, dV3];
    self.V = [V0, V1, V2, V3];

    out_sample / 2.
  }

  fn apply_all(
    &mut self,
    rendered_params: &[[f32; FRAME_SIZE]],
    _base_frequencies: &[f32; FRAME_SIZE],
    samples: &mut [f32; FRAME_SIZE],
  ) {
    // Param orderings:
    // [cutoff, resonance, drive]
    let cutoffs = unsafe { rendered_params.get_unchecked(0) };
    let resonances = unsafe { rendered_params.get_unchecked(1) };
    let drives = unsafe { rendered_params.get_unchecked(2) };

    let [mut dV0, mut dV1, mut dV2, mut dV3] = self.dV;
    let [mut tV0, mut tV1, mut tV2, mut tV3] = self.tV;
    let [mut V0, mut V1, mut V2, mut V3] = self.V;

    let mut last_sample = self.last_sample;
    for sample_ix in 0..samples.len() {
      let mut out_sample = 0.;
      let cur_sample = unsafe { *samples.get_unchecked(sample_ix) };

      // 2x oversampling
      for j in 0..=1 {
        let sample = if j == 0 {
          dsp::mix(0.5, last_sample, cur_sample)
        } else {
          cur_sample
        };

        let cutoff = dsp::clamp(1., 22_100., cutoffs[sample_ix]);
        let resonance = dsp::clamp(0., 20., resonances[sample_ix]);
        let drive = drives[sample_ix];

        let x = (PI * cutoff) / (2 * SAMPLE_RATE) as f32;
        let g = 4. * PI * VT * cutoff * (1. - x) / (1. + x);

        let new_dV0 = -g * (tanh((drive * sample + resonance * V3) / (2. * VT)) + tV0);
        V0 += (new_dV0 + dV0) / (2. * (SAMPLE_RATE * 2) as f32);
        dV0 = new_dV0;
        tV0 = tanh(V0 / (2. * VT));

        let new_dV1 = g * (tV0 - tV1);
        V1 += (new_dV1 + dV1) / (2. * (SAMPLE_RATE * 2) as f32);
        dV1 = new_dV1;
        tV1 = tanh(V1 / (2. * VT));

        let new_dV2 = g * (tV1 - tV2);
        V2 += (new_dV2 + dV2) / (2. * (SAMPLE_RATE * 2) as f32);
        dV2 = new_dV2;
        tV2 = tanh(V2 / (2. * VT));

        let new_dV3 = g * (tV2 - tV3);
        V3 += (new_dV3 + dV3) / (2. * (SAMPLE_RATE * 2) as f32);
        dV3 = new_dV3;
        tV3 = tanh(V3 / (2. * VT));

        out_sample += V3;
      }

      last_sample = cur_sample;
      unsafe { *samples.get_unchecked_mut(sample_ix) = out_sample / 2. };
    }

    self.tV = [tV0, tV1, tV2, tV3];
    self.dV = [dV0, dV1, dV2, dV3];
    self.V = [V0, V1, V2, V3];

    self.last_sample = last_sample;
  }

  fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
    buf[0] = Some(&mut self.cutoff);
    buf[1] = Some(&mut self.resonance);
    buf[2] = Some(&mut self.drive);
  }
}
