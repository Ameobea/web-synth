use dsp::filters::dc_blocker::DCBlocker;

use super::Effect;
use crate::fm::{ADSRState, ParamSource, ParamSourceType, FRAME_SIZE};

#[derive(Clone)]
pub struct Wavecruncher {
    pub top_fold_position: ParamSource,
    pub top_fold_width: ParamSource,
    pub bottom_fold_position: ParamSource,
    pub bottom_fold_width: ParamSource,
}

impl Default for Wavecruncher {
    fn default() -> Self {
        Wavecruncher {
            top_fold_position: ParamSource::new(ParamSourceType::Constant(1.)),
            top_fold_width: ParamSource::new(ParamSourceType::Constant(0.)),
            bottom_fold_position: ParamSource::new(ParamSourceType::Constant(-1.)),
            bottom_fold_width: ParamSource::new(ParamSourceType::Constant(0.)),
        }
    }
}

impl Effect for Wavecruncher {
    fn apply(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample: f32,
    ) -> f32 {
        let folded_sample = if sample > 0. {
            let fold_position = dsp::clamp(
                0.,
                1.,
                self.top_fold_position.get(
                    param_buffers,
                    adsrs,
                    sample_ix_within_frame,
                    base_frequency,
                ),
            );

            let overflow_amount = sample - fold_position;
            if overflow_amount <= 0. {
                return sample;
            }

            let fold_width = self.top_fold_width.get(
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            );

            sample + -(overflow_amount / fold_width).trunc() * fold_width * 2.
        } else {
            let fold_position = dsp::clamp(
                -1.,
                0.,
                self.bottom_fold_position.get(
                    param_buffers,
                    adsrs,
                    sample_ix_within_frame,
                    base_frequency,
                ),
            );

            let overflow_amount = -(sample - fold_position);
            if overflow_amount <= 0. {
                return sample;
            }

            let fold_width = self.bottom_fold_width.get(
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            );
            sample - -(overflow_amount / fold_width).trunc() * fold_width * 2.
        };

        dsp::clamp(-1., 1., folded_sample)
    }
}

#[derive(Clone)]
pub struct Wavefolder {
    pub gain: ParamSource,
    pub offset: ParamSource,
    dc_blocker: DCBlocker,
}

impl Wavefolder {
    pub fn new(gain: ParamSource, offset: ParamSource) -> Self {
        Wavefolder {
            gain,
            offset,
            dc_blocker: DCBlocker::default(),
        }
    }
}

impl Effect for Wavefolder {
    fn apply(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample: f32,
    ) -> f32 {
        let gain = self
            .gain
            .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);
        let offset = self
            .offset
            .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);

        // Credit to mikedorf for this: https://discord.com/channels/590254806208217089/590657587939115048/793255717569822780
        let output =
            fastapprox::faster::sinfull(std::f32::consts::PI * (sample * gain + offset / 2.));
        // Filter out extremely low frequencies / remove offset bias
        self.dc_blocker.apply(output)
        // output
    }
}
