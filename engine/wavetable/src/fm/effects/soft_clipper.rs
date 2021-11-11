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
            SoftClipperAlgorithm::Tanh => fastapprox::faster::tanh(sample),
            SoftClipperAlgorithm::XOverOnePlusAbsX => sample / (1. + sample.abs()),
            SoftClipperAlgorithm::HardClipper => dsp::clamp(-1., 1., sample),
        }
    }

    fn apply_all(&self, samples: &mut [f32]) {
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
                    *sample = fastapprox::faster::tanh(*sample);
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
    dc_blocker: DCBlocker,
    pub algorithm: SoftClipperAlgorithm,
}

impl SoftClipper {
    pub fn new(pre_gain: ParamSource, post_gain: ParamSource, algorithm: usize) -> Self {
        SoftClipper {
            pre_gain,
            post_gain,
            dc_blocker: DCBlocker::default(),
            algorithm: unsafe { std::mem::transmute(algorithm as u32) },
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
        // apply pre-gain
        for (sample_ix, sample) in samples.iter_mut().enumerate() {
            unsafe {
                *sample *= *rendered_params.get_unchecked(0).get_unchecked(sample_ix);
            }
        }

        self.algorithm.apply_all(samples);

        // apply post-gain
        for (sample_ix, sample) in samples.iter_mut().enumerate() {
            unsafe {
                *sample *= *rendered_params.get_unchecked(1).get_unchecked(sample_ix);
            }
        }
    }

    fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
        buf[0] = Some(&mut self.pre_gain);
        buf[1] = Some(&mut self.post_gain);
    }
}
