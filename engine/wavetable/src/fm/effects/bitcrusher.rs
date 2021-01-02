use super::Effect;
use crate::fm::{ADSRState, ParamSource, FRAME_SIZE};

#[derive(Clone)]
pub struct Bitcrusher {
    pub sample_rate: ParamSource,
    pub bit_depth: ParamSource,
    pub samples_since_last_sample: usize,
    pub held_sample: f32,
}

/// Same as `fastapprox::faster::pow2` except we elide the check for large negative values and
/// assume that negative values will never be passed to this function
fn even_faster_pow2(p: f32) -> f32 {
    let v = ((1 << 23) as f32 * (p + 126.94269504_f32)) as u32;
    fastapprox::bits::from_bits(v)
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
        let amplitude_bucket_count = even_faster_pow2(bit_depth);
        let bucket_size = 2. / amplitude_bucket_count;

        // dsp::clamp(
        //     -1.,
        //     1.,
        sample - (sample / bucket_size).fract() * bucket_size
        // )
    }
}

impl Effect for Bitcrusher {
    fn apply(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample: f32,
    ) -> f32 {
        let sample_rate = self
            .sample_rate
            .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency)
            .max(1.);
        let undersample_ratio = sample_rate / 44_100.;
        let sample_hold_time = 1. / undersample_ratio;
        self.samples_since_last_sample += 1;
        if (self.samples_since_last_sample as f32) < sample_hold_time {
            return self.held_sample;
        }
        self.samples_since_last_sample = 0;

        let bit_depth = dsp::clamp(
            1.,
            32.,
            self.bit_depth
                .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency),
        );

        self.held_sample = Self::discretize_sample(bit_depth, sample);
        self.held_sample
    }
}
