use adsr::Adsr;
use dsp::filters::dc_blocker::DCBlocker;

use super::Effect;
use crate::fm::ParamSource;

#[derive(Clone)]
pub struct SoftClipper {
    pub pre_gain: ParamSource,
    pub post_gain: ParamSource,
    dc_blocker: DCBlocker,
}

impl SoftClipper {
    pub fn new(pre_gain: ParamSource, post_gain: ParamSource) -> Self {
        SoftClipper {
            pre_gain,
            post_gain,
            dc_blocker: DCBlocker::default(),
        }
    }
}

impl Effect for SoftClipper {
    fn apply(
        &mut self,
        param_buffers: &[[f32; crate::fm::FRAME_SIZE]],
        adsrs: &[Adsr],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample: f32,
    ) -> f32 {
        let pre_gain =
            self.pre_gain
                .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);
        let post_gain =
            self.post_gain
                .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);
        let sample = sample * pre_gain;

        // Cubic non-linearity https://ccrma.stanford.edu/~jos/pasp/Soft_Clipping.html
        // Archive link https://web.archive.org/web/20200830021841/https://ccrma.stanford.edu/~jos/pasp/Soft_Clipping.html
        let output_sample = if sample <= -1. {
            -2. / 3.
        } else if sample >= 1. {
            2. / 3.
        } else {
            sample - (sample * sample * sample) / 3.
        };
        let output = output_sample * post_gain;
        // Filter out extremely lower frequencies / remove offset bias
        self.dc_blocker.apply(output)
    }
}
