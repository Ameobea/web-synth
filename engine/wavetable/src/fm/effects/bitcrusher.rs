use dsp::even_faster_pow2;

use super::Effect;
use crate::fm::ParamSource;

#[derive(Clone)]
pub struct Bitcrusher {
    pub sample_rate: ParamSource,
    pub bit_depth: ParamSource,
    pub samples_since_last_sample: usize,
    pub held_sample: f32,
}

impl Bitcrusher {
    pub fn new(sample_rate: ParamSource, bit_depth: ParamSource) -> Self {
        Bitcrusher {
            sample_rate,
            bit_depth,
            samples_since_last_sample: 0,
            held_sample: 0.,
        }
    }

    fn discretize_sample(bit_depth: f32, sample: f32) -> f32 {
        if bit_depth == 1. {
            return sample;
        }

        let amplitude_bucket_count = even_faster_pow2(bit_depth);
        dsp::quantize(-1., 1., amplitude_bucket_count, sample)
    }
}

impl Effect for Bitcrusher {
    fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
        let sample_rate = (unsafe { *rendered_params.get_unchecked(0) }).max(1.);
        let undersample_ratio = sample_rate / 44_100.;
        let sample_hold_time = 1. / undersample_ratio;
        self.samples_since_last_sample += 1;
        if (self.samples_since_last_sample as f32) < sample_hold_time {
            return self.held_sample;
        }
        self.samples_since_last_sample = 0;

        let bit_depth = dsp::clamp(1., 32., unsafe { *rendered_params.get_unchecked(1) });

        self.held_sample = Self::discretize_sample(bit_depth, sample);
        self.held_sample
    }

    fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
        buf[0] = Some(&mut self.sample_rate);
        buf[1] = Some(&mut self.bit_depth);
    }
}
