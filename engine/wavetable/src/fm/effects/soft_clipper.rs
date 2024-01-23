use dsp::filters::dc_blocker::DCBlocker;

use super::Effect;
use crate::fm::{ParamSource, FRAME_SIZE};

#[repr(u32)]
#[derive(Clone, Copy)]
pub enum SoftClipperAlgorithm {
  CubicNonlinearity,
  Tanh,
  XOverOnePlusAbsX,
  HardClipper,
}

impl SoftClipperAlgorithm {
  fn apply(&self, sample: f32) -> f32 {
    match self {
      // Cubic non-linearity https://ccrma.stanford.edu/~jos/pasp/Soft_Clipping.html
      // Archive link https://web.archive.org/web/20200830021841/https://ccrma.stanford.edu/~jos/pasp/Soft_Clipping.html
      SoftClipperAlgorithm::CubicNonlinearity =>
        if sample <= -1. {
          -2. / 3.
        } else if sample >= 1. {
          2. / 3.
        } else {
          sample - (sample * sample * sample) / 3.
        },
      SoftClipperAlgorithm::Tanh => fastapprox::fast::tanh(sample),
      SoftClipperAlgorithm::XOverOnePlusAbsX => sample / (1. + sample.abs()),
      SoftClipperAlgorithm::HardClipper => dsp::clamp(-1., 1., sample),
    }
  }

  fn apply_all(&self, samples: &mut [f32; FRAME_SIZE]) {
    match self {
      SoftClipperAlgorithm::CubicNonlinearity =>
        for sample in samples {
          *sample = if *sample <= -1. {
            -2. / 3.
          } else if *sample >= 1. {
            2. / 3.
          } else {
            *sample - (*sample * *sample * *sample) / 3.
          }
        },
      SoftClipperAlgorithm::Tanh =>
        for sample in samples {
          *sample = fastapprox::fast::tanh(*sample);
        },
      SoftClipperAlgorithm::XOverOnePlusAbsX =>
        for sample in samples {
          *sample = *sample / (1. + sample.abs());
        },
      SoftClipperAlgorithm::HardClipper =>
        for sample in samples {
          *sample = dsp::clamp(-1., 1., *sample);
        },
    }
  }
}

#[derive(Clone)]
pub struct SoftClipper {
  pub pre_gain: ParamSource,
  pub post_gain: ParamSource,
  pub mix: ParamSource,
  dc_blocker: DCBlocker,
  pub algorithm: SoftClipperAlgorithm,
  scratch: [f32; FRAME_SIZE],
}

impl SoftClipper {
  pub fn new(
    pre_gain: ParamSource,
    post_gain: ParamSource,
    mix: ParamSource,
    algorithm: usize,
  ) -> Self {
    SoftClipper {
      pre_gain,
      post_gain,
      mix,
      dc_blocker: DCBlocker::default(),
      algorithm: unsafe { std::mem::transmute(algorithm as u32) },
      scratch: [0.; FRAME_SIZE],
    }
  }
}

impl Effect for SoftClipper {
  fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
    let pre_gain = unsafe { *rendered_params.get_unchecked(0) };
    let post_gain = unsafe { *rendered_params.get_unchecked(1) };
    let sample = sample * pre_gain;

    let output_sample = self.algorithm.apply(sample);
    let output = output_sample * post_gain;
    // Filter out extremely lower frequencies / remove offset bias
    self.dc_blocker.apply(output)
  }

  fn apply_all(
    &mut self,
    rendered_params: &[[f32; FRAME_SIZE]],
    _base_frequencies: &[f32; FRAME_SIZE],
    samples: &mut [f32; FRAME_SIZE],
  ) {
    let pre_gains = unsafe { rendered_params.get_unchecked(0) };
    let post_gains = unsafe { rendered_params.get_unchecked(1) };
    let mixes = unsafe { rendered_params.get_unchecked(2) };

    // apply pre-gain
    for sample_ix in 0..FRAME_SIZE {
      unsafe {
        *self.scratch.get_unchecked_mut(sample_ix) =
          *pre_gains.get_unchecked(sample_ix) * *samples.get_unchecked(sample_ix);
      }
    }

    self.algorithm.apply_all(&mut self.scratch);

    // apply post-gain and mix
    for sample_ix in 0..FRAME_SIZE {
      unsafe {
        let mix = *mixes.get_unchecked(sample_ix);
        let mix = dsp::clamp(0., 1., mix);
        let post_gain = *post_gains.get_unchecked(sample_ix);
        let dry_sample = *samples.get_unchecked(sample_ix);
        *samples.get_unchecked_mut(sample_ix) =
          (*self.scratch.get_unchecked(sample_ix) * mix + dry_sample * (1. - mix)) * post_gain;
      }
    }
  }

  fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
    buf[0] = Some(&mut self.pre_gain);
    buf[1] = Some(&mut self.post_gain);
    buf[2] = Some(&mut self.mix);
  }
}
