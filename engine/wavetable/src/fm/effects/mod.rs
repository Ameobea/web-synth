use soft_clipper::SoftClipper;
use spectral_warping::SpectralWarpingParams;

use super::{ParamSource, ParamSourceType, RenderRawParams, FRAME_SIZE};

pub mod bitcrusher;
pub mod butterworth_filter;
pub mod soft_clipper;
pub mod spectral_warping;
pub mod wavefolder;

use self::{
    bitcrusher::Bitcrusher,
    butterworth_filter::{ButterworthFilter, ButterworthFilterMode},
    spectral_warping::SpectralWarping,
    wavefolder::{Wavecruncher, Wavefolder},
};

pub trait Effect {
    /// Should populate the provided buffer with pointers to internal `ParamSource`s for this
    /// effect.  It is expected that this buffer will contain all `None`s when it is provided as an
    /// argument to this function.
    ///
    /// The buffer should be filled up from front to back.  For example, if the effect implementing
    /// this method has only 2 parameters, the buffer should be modified to set index 0 and 1 to
    /// `Some(_)` and index 2 and 3 should be left as `None`.
    fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]);

    fn apply(&mut self, rendered_params: &[f32], base_frequency: f32, sample: f32) -> f32;

    /// Apply the effect to the buffer of samples in-place
    fn apply_all(
        &mut self,
        rendered_params: &[[f32; FRAME_SIZE]],
        base_frequencies: &[f32; FRAME_SIZE],
        samples: &mut [f32; FRAME_SIZE],
    ) {
        let mut params_for_sample = [0.; 4];
        // Fall back to the serial implementation if a SIMD one isn't available
        for sample_ix_within_frame in 0..FRAME_SIZE {
            for i in 0..rendered_params.len() {
                unsafe {
                    *params_for_sample.get_unchecked_mut(i) = *rendered_params
                        .get_unchecked(i)
                        .get_unchecked(sample_ix_within_frame);
                }
            }

            let sample = unsafe { samples.get_unchecked_mut(sample_ix_within_frame) };
            let base_frequency = unsafe { *base_frequencies.get_unchecked(sample_ix_within_frame) };

            *sample = self.apply(
                unsafe {
                    std::slice::from_raw_parts(params_for_sample.as_ptr(), rendered_params.len())
                },
                base_frequency,
                *sample,
            );
        }
    }
}

#[derive(Clone)]
pub enum EffectInstance {
    SpectralWarping(SpectralWarping),
    Wavecruncher(Wavecruncher),
    Bitcrusher(Bitcrusher),
    Wavefolder(Wavefolder),
    SoftClipper(SoftClipper),
    ButterworthFilter(ButterworthFilter),
}

impl EffectInstance {
    /// Construts a new effect instance from the raw params passed over from JS
    pub fn from_parts(
        effect_type: usize,
        param_1_type: usize,
        param_1_int_val: usize,
        param_1_float_val: f32,
        param_1_float_val_2: f32,
        param_2_type: usize,
        param_2_int_val: usize,
        param_2_float_val: f32,
        param_2_float_val_2: f32,
        param_3_type: usize,
        param_3_int_val: usize,
        param_3_float_val: f32,
        param_3_float_val_2: f32,
        param_4_type: usize,
        param_4_int_val: usize,
        param_4_float_val: f32,
        param_4_float_val_2: f32,
    ) -> Self {
        match effect_type {
            0 => {
                let frequency = ParamSource::new(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                    param_1_float_val_2,
                ));
                let warp_factor = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                    param_2_float_val_2,
                ));
                let params = SpectralWarpingParams {
                    frequency,
                    warp_factor,
                };

                EffectInstance::SpectralWarping(SpectralWarping::new(params))
            },
            1 => {
                let top_fold_position = ParamSource::new(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                    param_1_float_val_2,
                ));
                let top_fold_width = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                    param_2_float_val_2,
                ));
                let bottom_fold_position = ParamSource::new(ParamSourceType::from_parts(
                    param_3_type,
                    param_3_int_val,
                    param_3_float_val,
                    param_3_float_val_2,
                ));
                let bottom_fold_width = ParamSource::new(ParamSourceType::from_parts(
                    param_4_type,
                    param_4_int_val,
                    param_4_float_val,
                    param_4_float_val_2,
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
                    param_1_float_val_2,
                ));
                let bit_depth = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                    param_2_float_val_2,
                ));

                EffectInstance::Bitcrusher(Bitcrusher::new(sample_rate, bit_depth))
            },
            3 => {
                let gain = ParamSource::new(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                    param_1_float_val_2,
                ));
                let offset = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                    param_2_float_val_2,
                ));

                EffectInstance::Wavefolder(Wavefolder::new(gain, offset))
            },
            4 => {
                let pre_gain = ParamSource::new(ParamSourceType::from_parts(
                    param_1_type,
                    param_1_int_val,
                    param_1_float_val,
                    param_1_float_val_2,
                ));
                let post_gain = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                    param_2_float_val_2,
                ));
                let algorithm = param_3_int_val;

                EffectInstance::SoftClipper(SoftClipper::new(pre_gain, post_gain, algorithm))
            },
            5 => {
                let mode = ButterworthFilterMode::from(param_1_int_val);
                let cutoff_freq = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                    param_2_float_val_2,
                ));

                EffectInstance::ButterworthFilter(ButterworthFilter::new(mode, cutoff_freq))
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
        param_1_float_val_2: f32,
        param_2_type: usize,
        param_2_int_val: usize,
        param_2_float_val: f32,
        param_2_float_val_2: f32,
        _param_3_type: usize,
        param_3_int_val: usize,
        _param_3_float_val: f32,
        _param_3_float_val_2: f32,
        _param_4_type: usize,
        _param_4_int_val: usize,
        _param_4_float_val: f32,
        _param_4_float_val_2: f32,
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
                        param_1_float_val_2,
                    ));
                spectral_warping
                    .osc
                    .stretch_factor
                    .replace(ParamSourceType::from_parts(
                        param_2_type,
                        param_2_int_val,
                        param_2_float_val,
                        param_2_float_val_2,
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
                    param_1_float_val_2,
                ));
                bitcrusher.bit_depth.replace(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                    param_2_float_val_2,
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
                    param_1_float_val_2,
                ));
                wavefolder.offset.replace(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                    param_2_float_val_2,
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
                    param_1_float_val_2,
                ));
                soft_clipper.post_gain.replace(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                    param_2_float_val_2,
                ));
                soft_clipper.algorithm = unsafe { std::mem::transmute(param_3_int_val as u32) };
                return true;
            },
            5 => {
                let butterworth_filter = match self {
                    EffectInstance::ButterworthFilter(butterworth_filter) => butterworth_filter,
                    _ => return false,
                };

                let mode = ButterworthFilterMode::from(param_1_int_val);
                let cutoff_freq = ParamSource::new(ParamSourceType::from_parts(
                    param_2_type,
                    param_2_int_val,
                    param_2_float_val,
                    param_2_float_val_2,
                ));

                butterworth_filter.mode = mode;
                butterworth_filter.cutoff_freq = cutoff_freq;
                return true;
            },
            _ => false,
        }
    }
}

impl Effect for EffectInstance {
    fn apply(&mut self, rendered_params: &[f32], base_frequency: f32, sample: f32) -> f32 {
        match self {
            EffectInstance::SpectralWarping(e) => e.apply(rendered_params, base_frequency, sample),
            EffectInstance::Wavecruncher(e) => e.apply(rendered_params, base_frequency, sample),
            EffectInstance::Bitcrusher(e) => e.apply(rendered_params, base_frequency, sample),
            EffectInstance::Wavefolder(e) => e.apply(rendered_params, base_frequency, sample),
            EffectInstance::SoftClipper(e) => e.apply(rendered_params, base_frequency, sample),
            EffectInstance::ButterworthFilter(e) =>
                e.apply(rendered_params, base_frequency, sample),
        }
    }

    fn apply_all(
        &mut self,
        rendered_params: &[[f32; FRAME_SIZE]],
        base_frequencies: &[f32; FRAME_SIZE],
        samples: &mut [f32; FRAME_SIZE],
    ) {
        match self {
            EffectInstance::SpectralWarping(e) =>
                e.apply_all(rendered_params, base_frequencies, samples),
            EffectInstance::Wavecruncher(e) =>
                e.apply_all(rendered_params, base_frequencies, samples),
            EffectInstance::Bitcrusher(e) =>
                e.apply_all(rendered_params, base_frequencies, samples),
            EffectInstance::Wavefolder(e) =>
                e.apply_all(rendered_params, base_frequencies, samples),
            EffectInstance::SoftClipper(e) =>
                e.apply_all(rendered_params, base_frequencies, samples),
            EffectInstance::ButterworthFilter(e) =>
                e.apply_all(rendered_params, base_frequencies, samples),
        }
    }

    fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; 4]) {
        match self {
            EffectInstance::SpectralWarping(e) => e.get_params(buf),
            EffectInstance::Wavecruncher(e) => e.get_params(buf),
            EffectInstance::Bitcrusher(e) => e.get_params(buf),
            EffectInstance::Wavefolder(e) => e.get_params(buf),
            EffectInstance::SoftClipper(e) => e.get_params(buf),
            EffectInstance::ButterworthFilter(e) => e.get_params(buf),
        }
    }
}

#[derive(Clone)]
pub struct EffectContainer {
    pub inst: Box<EffectInstance>,
    pub is_bypassed: bool,
}

#[derive(Clone)]
pub struct EffectChain {
    effects: [Option<EffectContainer>; 16],
    param_render_buf: Box<[[[f32; FRAME_SIZE]; 4]; 16]>,
}

impl Default for EffectChain {
    fn default() -> Self {
        EffectChain {
            effects: [
                None, None, None, None, None, None, None, None, None, None, None, None, None, None,
                None, None,
            ],
            param_render_buf: box unsafe { std::mem::MaybeUninit::uninit().assume_init() },
        }
    }
}

impl EffectChain {
    pub fn set_effect(
        &mut self,
        effect_ix: usize,
        effect_type: usize,
        param_1_type: usize,
        param_1_int_val: usize,
        param_1_float_val: f32,
        param_1_float_val_2: f32,
        param_2_type: usize,
        param_2_int_val: usize,
        param_2_float_val: f32,
        param_2_float_val_2: f32,
        param_3_type: usize,
        param_3_int_val: usize,
        param_3_float_val: f32,
        param_3_float_val_2: f32,
        param_4_type: usize,
        param_4_int_val: usize,
        param_4_float_val: f32,
        param_4_float_val_2: f32,
        is_bypassed: bool,
    ) {
        if let Some(effect) = &mut self.effects[effect_ix] {
            let successfully_updated = effect.inst.maybe_update_from_parts(
                effect_type,
                param_1_type,
                param_1_int_val,
                param_1_float_val,
                param_1_float_val_2,
                param_2_type,
                param_2_int_val,
                param_2_float_val,
                param_2_float_val_2,
                param_3_type,
                param_3_int_val,
                param_3_float_val,
                param_3_float_val_2,
                param_4_type,
                param_4_int_val,
                param_4_float_val,
                param_4_float_val_2,
            );
            if successfully_updated {
                effect.is_bypassed = is_bypassed;
                return;
            }
        }

        self.effects[effect_ix] = Some(EffectContainer {
            inst: box EffectInstance::from_parts(
                effect_type,
                param_1_type,
                param_1_int_val,
                param_1_float_val,
                param_1_float_val_2,
                param_2_type,
                param_2_int_val,
                param_2_float_val,
                param_2_float_val_2,
                param_3_type,
                param_3_int_val,
                param_3_float_val,
                param_3_float_val_2,
                param_4_type,
                param_4_int_val,
                param_4_float_val,
                param_4_float_val_2,
            ),
            is_bypassed,
        });
    }

    pub fn remove_effect(&mut self, effect_ix: usize) {
        self.effects[effect_ix] = None;
        // Shift all effects after the removed one down to fill the empty space
        for effect_ix in effect_ix + 1..self.effects.len() {
            self.effects[effect_ix - 1] = self.effects[effect_ix].take();
        }
    }
}

/// Given an arbitrary effect, queries the effect for its current list of parameters.  Then, renders
/// the output of each of those parameters into a set of buffers.
///
/// Returns the number of params for the effect.
fn render_effect_params<'a, E: Effect>(
    effect: &mut E,
    buffers: &mut [[f32; FRAME_SIZE]; 4],
    inputs: &RenderRawParams<'a>,
) -> usize {
    let mut params: [Option<&mut ParamSource>; 4] = [None, None, None, None];
    effect.get_params(&mut params);

    for (i, param) in core::array::IntoIter::new(params).enumerate() {
        let param = match param {
            Some(param) => param,
            None => return i,
        };
        let output_buf = unsafe { buffers.get_unchecked_mut(i) };
        param.render_raw(inputs, output_buf)
    }
    4
}

impl EffectChain {
    pub fn pre_render_params<'a>(&mut self, render_params: &RenderRawParams<'a>) {
        for (effect_ix, effect) in self.effects.iter_mut().enumerate() {
            let effect = match effect {
                Some(effect_container) =>
                    if effect_container.is_bypassed {
                        continue;
                    } else {
                        &mut effect_container.inst
                    },
                _ => return,
            };

            let buffers = unsafe { self.param_render_buf.get_unchecked_mut(effect_ix) };
            render_effect_params(&mut **effect, buffers, render_params);
        }
    }

    fn get_rendered_param(
        param_render_buf: &[[[f32; FRAME_SIZE]; 4]; 16],
        effect_ix: usize,
        param_ix: usize,
        sample_ix_within_frame: usize,
    ) -> f32 {
        unsafe {
            *param_render_buf
                .get_unchecked(effect_ix)
                .get_unchecked(param_ix)
                .get_unchecked(sample_ix_within_frame)
        }
    }

    pub fn apply<'a>(
        &mut self,
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample: f32,
    ) -> f32 {
        let mut output = sample;

        let mut params_for_sample: [f32; 4] =
            unsafe { std::mem::MaybeUninit::uninit().assume_init() };
        for (effect_ix, effect) in self.effects.iter_mut().enumerate() {
            let effect = match effect {
                Some(effect_container) =>
                    if effect_container.is_bypassed {
                        continue;
                    } else {
                        &mut effect_container.inst
                    },
                None => break,
            };

            for param_ix in 0..4 {
                params_for_sample[param_ix] = Self::get_rendered_param(
                    &self.param_render_buf,
                    effect_ix,
                    param_ix,
                    sample_ix_within_frame,
                );
            }

            output = effect.apply(&params_for_sample, base_frequency, output);
        }
        output
    }

    pub fn apply_all<'a>(
        &mut self,
        render_params: &RenderRawParams<'a>,
        samples: &mut [f32; FRAME_SIZE],
    ) {
        let mut rendered_params: [[f32; FRAME_SIZE]; 4] =
            unsafe { std::mem::MaybeUninit::uninit().assume_init() };

        for effect in &mut self.effects {
            let effect = match effect {
                Some(effect_container) =>
                    if effect_container.is_bypassed {
                        continue;
                    } else {
                        &mut effect_container.inst
                    },
                None => return,
            };
            let param_count =
                render_effect_params(&mut **effect, &mut rendered_params, render_params);
            let rendered_params =
                unsafe { std::slice::from_raw_parts(rendered_params.as_ptr(), param_count) };

            effect.apply_all(rendered_params, &render_params.base_frequencies, samples);
        }
    }
}
