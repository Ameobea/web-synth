use soft_clipper::SoftClipper;
use spectral_warping::SpectralWarpingParams;

use super::{ADSRState, ParamSource, ParamSourceType, FRAME_SIZE};

pub mod bitcrusher;
pub mod soft_clipper;
pub mod spectral_warping;
pub mod wavefolder;

use self::{
    bitcrusher::Bitcrusher,
    spectral_warping::SpectralWarping,
    wavefolder::{Wavecruncher, Wavefolder},
};

pub trait Effect {
    fn apply(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample: f32,
    ) -> f32;
}

#[derive(Clone)]
pub enum EffectInstance {
    SpectralWarping(SpectralWarping),
    Wavecruncher(Wavecruncher),
    Bitcrusher(Bitcrusher),
    Wavefolder(Wavefolder),
    SoftClipper(SoftClipper),
}

impl EffectInstance {
    /// Construts a new effect instance from the raw params passed over from JS
    pub fn from_parts(
        effect_type: usize,
        param_1_type: usize,
        param_1_int_val: usize,
        param_1_float_val: f32,
        param_2_type: usize,
        param_2_int_val: usize,
        param_2_float_val: f32,
        param_3_type: usize,
        param_3_int_val: usize,
        param_3_float_val: f32,
        param_4_type: usize,
        param_4_int_val: usize,
        param_4_float_val: f32,
    ) -> Self {
        match effect_type {
            0 => {
                let frequency = ParamSource::new(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                ));
                let warp_factor = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                ));
                let params = SpectralWarpingParams {
                    frequency,
                    warp_factor,
                    phase_offset: 0.,
                };

                EffectInstance::SpectralWarping(SpectralWarping::new(params))
            },
            1 => {
                let top_fold_position = ParamSource::new(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                ));
                let top_fold_width = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                ));
                let bottom_fold_position = ParamSource::new(ParamSourceType::from_parts(
                    param_3_type,
                    param_3_int_val,
                    param_3_float_val,
                ));
                let bottom_fold_width = ParamSource::new(ParamSourceType::from_parts(
                    param_4_type,
                    param_4_int_val,
                    param_4_float_val,
                ));

                EffectInstance::Wavecruncher(Wavecruncher {
                    top_fold_position,
                    top_fold_width,
                    bottom_fold_position,
                    bottom_fold_width,
                })
            },
            2 => {
                let sample_rate = ParamSource::new(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                ));
                let bit_depth = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                ));

                EffectInstance::Bitcrusher(Bitcrusher::new(sample_rate, bit_depth))
            },
            3 => {
                let gain = ParamSource::new(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                ));
                let offset = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                ));

                EffectInstance::Wavefolder(Wavefolder::new(gain, offset))
            },
            4 => {
                let pre_gain = ParamSource::new(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                ));
                let post_gain = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                ));

                EffectInstance::SoftClipper(SoftClipper::new(pre_gain, post_gain))
            },
            _ => panic!("Invalid effect type: {}", effect_type),
        }
    }

    /// Attempts to update an effect in-place with new settings.  Returns `true` if successful.
    pub fn maybe_update_from_parts(
        &mut self,
        effect_type: usize,
        param_1_type: usize,
        param_1_int_val: usize,
        param_1_float_val: f32,
        param_2_type: usize,
        param_2_int_val: usize,
        param_2_float_val: f32,
        _param_3_type: usize,
        _param_3_int_val: usize,
        _param_3_float_val: f32,
        _param_4_type: usize,
        _param_4_int_val: usize,
        _param_4_float_val: f32,
    ) -> bool {
        match effect_type {
            0 => {
                let spectral_warping = match self {
                    EffectInstance::SpectralWarping(spectral_warping) => spectral_warping,
                    _ => return false,
                };
                spectral_warping
                    .frequency
                    .replace(ParamSourceType::from_parts(
                        param_1_type,
                        param_1_int_val,
                        param_1_float_val,
                    ));
                spectral_warping
                    .osc
                    .stretch_factor
                    .replace(ParamSourceType::from_parts(
                        param_2_type,
                        param_2_int_val,
                        param_2_float_val,
                    ));

                return true;
            },
            1 => {
                // If things get a bit crunchy here I don't really care
                // (too lazy to impl this)
                false
            },
            2 => {
                let bitcrusher = match self {
                    EffectInstance::Bitcrusher(bitcrusher) => bitcrusher,
                    _ => return false,
                };

                bitcrusher.sample_rate.replace(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                ));
                bitcrusher.bit_depth.replace(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                ));

                return true;
            },
            3 => {
                let wavefolder = match self {
                    EffectInstance::Wavefolder(wavefolder) => wavefolder,
                    _ => return false,
                };

                wavefolder.gain.replace(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                ));
                wavefolder.offset.replace(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                ));

                return true;
            },
            4 => {
                let soft_clipper = match self {
                    EffectInstance::SoftClipper(soft_clipper) => soft_clipper,
                    _ => return false,
                };

                soft_clipper.pre_gain.replace(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                ));
                soft_clipper.post_gain.replace(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                ));

                return true;
            },
            _ => false,
        }
    }
}

impl Effect for EffectInstance {
    fn apply(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample: f32,
    ) -> f32 {
        match self {
            EffectInstance::SpectralWarping(e) => e.apply(
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
                sample,
            ),
            EffectInstance::Wavecruncher(e) => e.apply(
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
                sample,
            ),
            EffectInstance::Bitcrusher(e) => e.apply(
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
                sample,
            ),
            EffectInstance::Wavefolder(e) => e.apply(
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
                sample,
            ),
            EffectInstance::SoftClipper(e) => e.apply(
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
                sample,
            ),
        }
    }
}

#[derive(Clone, Default)]
pub struct EffectChain([Option<Box<EffectInstance>>; 16]);

impl EffectChain {
    pub fn set_effect(
        &mut self,
        effect_ix: usize,
        effect_type: usize,
        param_1_type: usize,
        param_1_int_val: usize,
        param_1_float_val: f32,
        param_2_type: usize,
        param_2_int_val: usize,
        param_2_float_val: f32,
        param_3_type: usize,
        param_3_int_val: usize,
        param_3_float_val: f32,
        param_4_type: usize,
        param_4_int_val: usize,
        param_4_float_val: f32,
    ) {
        if let Some(effect) = &mut self.0[effect_ix] {
            let successfully_updated = effect.maybe_update_from_parts(
                effect_type,
                param_1_type,
                param_1_int_val,
                param_1_float_val,
                param_2_type,
                param_2_int_val,
                param_2_float_val,
                param_3_type,
                param_3_int_val,
                param_3_float_val,
                param_4_type,
                param_4_int_val,
                param_4_float_val,
            );
            if successfully_updated {
                return;
            }
        }

        self.0[effect_ix] = Some(box EffectInstance::from_parts(
            effect_type,
            param_1_type,
            param_1_int_val,
            param_1_float_val,
            param_2_type,
            param_2_int_val,
            param_2_float_val,
            param_3_type,
            param_3_int_val,
            param_3_float_val,
            param_4_type,
            param_4_int_val,
            param_4_float_val,
        ));
    }

    pub fn remove_effect(&mut self, effect_ix: usize) {
        self.0[effect_ix] = None;
        // Shift all effects after the removed one down to fill the empty space
        for effect_ix in effect_ix + 1..self.0.len() {
            self.0[effect_ix - 1] = self.0[effect_ix].take();
        }
    }
}

impl Effect for EffectChain {
    fn apply(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        mut sample: f32,
    ) -> f32 {
        for effect in &mut self.0 {
            let effect = match effect {
                Some(effect) => effect,
                None => return sample,
            };
            sample = effect.apply(
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
                sample,
            );
        }
        sample
    }
}

impl EffectChain {
    pub fn apply_all(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        base_frequencies: &[f32],
        samples: &mut [f32],
    ) {
        if self.0[0].is_none() {
            return;
        }

        for sample_ix_within_frame in 0..FRAME_SIZE {
            let sample = unsafe { samples.get_unchecked_mut(sample_ix_within_frame) };
            let base_frequency = unsafe { *base_frequencies.get_unchecked(sample_ix_within_frame) };

            for effect in &mut self.0 {
                let effect = match effect {
                    Some(effect) => effect,
                    None => continue,
                };
                *sample = effect.apply(
                    param_buffers,
                    adsrs,
                    sample_ix_within_frame,
                    base_frequency,
                    *sample,
                );
            }
        }
    }
}
