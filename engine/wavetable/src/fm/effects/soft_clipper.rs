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
    fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
        let pre_gain = unsafe { *rendered_params.get_unchecked(0) };
        let post_gain = unsafe { *rendered_params.get_unchecked(1) };
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

    fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
        buf[0] = Some(&mut self.pre_gain);
        buf[1] = Some(&mut self.post_gain);
    }
}
