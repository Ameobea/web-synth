use super::Effect;
use crate::fm::{ADSRState, ParamSource, FRAME_SIZE};

#[derive(Clone)]
pub struct Wavefolder {
    pub top_fold_position: ParamSource,
    pub top_fold_width: ParamSource,
    pub bottom_fold_position: ParamSource,
    pub bottom_fold_width: ParamSource,
}

impl Default for Wavefolder {
    fn default() -> Self {
        Wavefolder {
            top_fold_position: ParamSource::Constant(1.),
            top_fold_width: ParamSource::Constant(0.),
            bottom_fold_position: ParamSource::Constant(-1.),
            bottom_fold_width: ParamSource::Constant(0.),
        }
    }
}

impl Effect for Wavefolder {
    fn apply(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        _base_frequency: f32,
        sample: f32,
    ) -> f32 {
        let folded_sample = if sample > 0. {
            let fold_position =
                self.top_fold_position
                    .get(param_buffers, adsrs, sample_ix_within_frame);

            let overflow_amount = sample - fold_position;
            if overflow_amount <= 0. {
                return sample;
            }

            let fold_width = self
                .top_fold_width
                .get(param_buffers, adsrs, sample_ix_within_frame);

            sample + -(overflow_amount / fold_width).trunc() * fold_width
        } else {
            let fold_position =
                self.bottom_fold_position
                    .get(param_buffers, adsrs, sample_ix_within_frame);

            let overflow_amount = sample - fold_position;
            if overflow_amount >= 0. {
                return sample;
            }

            let fold_width =
                self.bottom_fold_width
                    .get(param_buffers, adsrs, sample_ix_within_frame);
            sample - -(overflow_amount / fold_width).trunc() * fold_width
        };

        dsp::clamp(-1., 1., folded_sample)
    }
}
