use dsp::filters::dc_blocker::DCBlocker;

use super::Effect;
use crate::fm::{ParamSource, FRAME_SIZE};

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
            top_fold_position: ParamSource::new_constant(1.),
            top_fold_width: ParamSource::new_constant(0.),
            bottom_fold_position: ParamSource::new_constant(-1.),
            bottom_fold_width: ParamSource::new_constant(0.),
        }
    }
}

impl Effect for Wavecruncher {
    fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
        let top_fold_position = unsafe { *rendered_params.get_unchecked(0) };
        let top_fold_width = unsafe { *rendered_params.get_unchecked(1) };
        let bottom_fold_position = unsafe { *rendered_params.get_unchecked(2) };
        let bottom_fold_width = unsafe { *rendered_params.get_unchecked(3) };

        let folded_sample = if sample > 0. {
            let fold_position = dsp::clamp(0., 1., top_fold_position);

            let overflow_amount = sample - fold_position;
            if overflow_amount <= 0. {
                return sample;
            }

            sample + -(overflow_amount / top_fold_width).trunc() * top_fold_width * 2.
        } else {
            let fold_position = dsp::clamp(-1., 0., bottom_fold_position);

            let overflow_amount = -(sample - fold_position);
            if overflow_amount <= 0. {
                return sample;
            }

            sample - -(overflow_amount / bottom_fold_width).trunc() * bottom_fold_width * 2.
        };

        dsp::clamp(-1., 1., folded_sample)
    }

    fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
        buf[0] = Some(&mut self.top_fold_position);
        buf[1] = Some(&mut self.top_fold_width);
        buf[2] = Some(&mut self.bottom_fold_position);
        buf[3] = Some(&mut self.bottom_fold_width);
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
    fn apply(&mut self, rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
        let gain = unsafe { *rendered_params.get_unchecked(0) };
        let offset = unsafe { *rendered_params.get_unchecked(1) };

        // Credit to mikedorf for this: https://discord.com/channels/590254806208217089/590657587939115048/793255717569822780
        let output =
            fastapprox::faster::sinfull(std::f32::consts::PI * (sample * gain + offset / 2.));
        // Filter out extremely low frequencies / remove offset bias
        self.dc_blocker.apply(output)
    }

    fn apply_all(
        &mut self,
        rendered_params: &[[f32; FRAME_SIZE]],
        _base_frequencies: &[f32; FRAME_SIZE],
        samples: &mut [f32; FRAME_SIZE],
    ) {
        let rendered_gain = unsafe { rendered_params.get_unchecked(0) };
        let rendered_offset = unsafe { rendered_params.get_unchecked(0) };

        for i in 0..FRAME_SIZE {
            unsafe {
                let sample = samples.get_unchecked(i);
                let gain = *rendered_gain.get_unchecked(i);
                let offset = *rendered_offset.get_unchecked(i);

                let output = fastapprox::faster::sinfull(
                    std::f32::consts::PI * (sample * gain + offset / 2.),
                );
                // Filter out extremely low frequencies / remove offset bias

                *samples.get_unchecked_mut(i) = self.dc_blocker.apply(output);
            }
        }
    }

    fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
        buf[0] = Some(&mut self.gain);
        buf[1] = Some(&mut self.offset);
    }
}
