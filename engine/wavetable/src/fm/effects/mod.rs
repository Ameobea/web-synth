use spectral_warping::SpectralWarpingParams;

use super::{ADSRState, OperatorFrequencySource, ParamSource, FRAME_SIZE};

pub mod bitcrusher;
pub mod spectral_warping;
pub mod wavefolder;

use self::{bitcrusher::Bitcrusher, spectral_warping::SpectralWarping, wavefolder::Wavefolder};

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
    SpectralWarping(Box<SpectralWarping>),
    Wavefolder(Wavefolder),
    Bitcrusher(Bitcrusher),
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
                let frequency = OperatorFrequencySource::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                );
                let warp_factor =
                    ParamSource::from_parts(param_2_type, param_2_int_val, param_2_float_val);
                let params = SpectralWarpingParams {
                    frequency,
                    warp_factor,
                    phase_offset: 0.,
                };

                EffectInstance::SpectralWarping(box SpectralWarping::new(params))
            },
            1 => {
                let top_fold_position =
                    ParamSource::from_parts(param_1_type, param_1_int_val, param_1_float_val);
                let top_fold_width =
                    ParamSource::from_parts(param_2_type, param_2_int_val, param_2_float_val);
                let bottom_fold_position =
                    ParamSource::from_parts(param_3_type, param_3_int_val, param_3_float_val);
                let bottom_fold_width =
                    ParamSource::from_parts(param_4_type, param_4_int_val, param_4_float_val);

                EffectInstance::Wavefolder(Wavefolder {
                    top_fold_position,
                    top_fold_width,
                    bottom_fold_position,
                    bottom_fold_width,
                })
            },
            2 => {
                todo!()
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
                spectral_warping.frequency = OperatorFrequencySource::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                );
                spectral_warping.osc.stretch_factor =
                    ParamSource::from_parts(param_2_type, param_2_int_val, param_2_float_val);

                return true;
            },
            1 => {
                // Wavefolder is stateless
                false
            },
            2 => {
                // Bitcrusher is stateless
                false
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
            EffectInstance::Wavefolder(e) => e.apply(
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
        }
    }
}

#[derive(Clone, Default)]
pub struct EffectChain([Option<EffectInstance>; 16]);

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

        self.0[effect_ix] = Some(EffectInstance::from_parts(
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
