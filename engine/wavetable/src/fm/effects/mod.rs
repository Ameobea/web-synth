use ::compressor::MultibandCompressor;
use dsp::circular_buffer::CircularBuffer;
use rand::Rng;
use soft_clipper::SoftClipper;
use spectral_warping::SpectralWarpingParams;

use crate::fm::effects::comb_filter::CombFilter;

use super::{uninit, ParamSource, RenderRawParams, FRAME_SIZE};

pub mod bitcrusher;
pub mod butterworth_filter;
pub mod chorus;
pub mod comb_filter;
pub mod compressor;
pub mod delay;
pub mod moog;
pub mod soft_clipper;
pub mod spectral_warping;
pub mod wavefolder;

use self::{
  bitcrusher::Bitcrusher,
  butterworth_filter::{ButterworthFilter, ButterworthFilterMode},
  chorus::ChorusEffect,
  compressor::CompressorEffect,
  delay::Delay,
  moog::MoogFilter,
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
  fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; MAX_PARAM_COUNT]);

  fn apply(&mut self, rendered_params: &[f32], base_frequency: f32, sample: f32) -> f32;

  /// Apply the effect to the buffer of samples in-place
  fn apply_all(
    &mut self,
    rendered_params: &[[f32; FRAME_SIZE]],
    base_frequencies: &[f32; FRAME_SIZE],
    samples: &mut [f32; FRAME_SIZE],
  ) {
    let mut params_for_sample = [0.; MAX_PARAM_COUNT];
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
        unsafe { std::slice::from_raw_parts(params_for_sample.as_ptr(), rendered_params.len()) },
        base_frequency,
        *sample,
      );
    }
  }

  /// Resets the effect to its initial state.  Called after a voice is freshly gated.
  ///
  /// Useful for effects with internal state like delay lines.
  fn reset(&mut self) {}
}

#[derive(Clone)]
pub enum EffectInstance {
  SpectralWarping(SpectralWarping),
  Wavecruncher(Wavecruncher),
  Bitcrusher(Bitcrusher),
  Wavefolder(Wavefolder),
  SoftClipper(SoftClipper),
  ButterworthFilter(ButterworthFilter),
  Delay(Delay),
  MoogFilter(MoogFilter),
  CombFilter(CombFilter),
  Compressor(CompressorEffect),
  Chorus(ChorusEffect),
}

impl EffectInstance {
  /// Construts a new effect instance from the raw params passed over from JS
  pub fn from_parts(
    effect_type: usize,
    param_1_type: usize,
    param_1_int_val: usize,
    param_1_float_val: f32,
    param_1_float_val_2: f32,
    param_1_float_val_3: f32,
    param_2_type: usize,
    param_2_int_val: usize,
    param_2_float_val: f32,
    param_2_float_val_2: f32,
    param_2_float_val_3: f32,
    param_3_type: usize,
    param_3_int_val: usize,
    param_3_float_val: f32,
    param_3_float_val_2: f32,
    param_3_float_val_3: f32,
    param_4_type: usize,
    param_4_int_val: usize,
    param_4_float_val: f32,
    param_4_float_val_2: f32,
    param_4_float_val_3: f32,
  ) -> Self {
    match effect_type {
      0 => {
        let frequency = ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        );
        let warp_factor = ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        );
        let params = SpectralWarpingParams {
          frequency,
          warp_factor,
        };

        EffectInstance::SpectralWarping(SpectralWarping::new(params))
      },
      1 => {
        let top_fold_position = ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        );
        let top_fold_width = ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        );
        let bottom_fold_position = ParamSource::from_parts(
          param_3_type,
          param_3_int_val,
          param_3_float_val,
          param_3_float_val_2,
          param_3_float_val_3,
        );
        let bottom_fold_width = ParamSource::from_parts(
          param_4_type,
          param_4_int_val,
          param_4_float_val,
          param_4_float_val_2,
          param_4_float_val_3,
        );

        EffectInstance::Wavecruncher(Wavecruncher {
          top_fold_position,
          top_fold_width,
          bottom_fold_position,
          bottom_fold_width,
        })
      },
      2 => {
        let sample_rate = ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        );
        let bit_depth = ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        );
        let mix = ParamSource::from_parts(
          param_3_type,
          param_3_int_val,
          param_3_float_val,
          param_3_float_val_2,
          param_3_float_val_3,
        );

        EffectInstance::Bitcrusher(Bitcrusher::new(sample_rate, bit_depth, mix))
      },
      3 => {
        let gain = ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        );
        let offset = ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        );
        let mix = ParamSource::from_parts(
          param_3_type,
          param_3_int_val,
          param_3_float_val,
          param_3_float_val_2,
          param_3_float_val_3,
        );

        EffectInstance::Wavefolder(Wavefolder::new(gain, offset, mix))
      },
      4 => {
        let pre_gain = ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        );
        let post_gain = ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        );
        let mix = ParamSource::from_parts(
          param_3_type,
          param_3_int_val,
          param_3_float_val,
          param_3_float_val_2,
          param_3_float_val_3,
        );
        let algorithm = param_4_int_val;

        EffectInstance::SoftClipper(SoftClipper::new(pre_gain, post_gain, mix, algorithm))
      },
      5 => {
        let mode = ButterworthFilterMode::from(param_1_int_val);
        let cutoff_freq = ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        );

        EffectInstance::ButterworthFilter(ButterworthFilter::new(mode, cutoff_freq))
      },
      6 => {
        let delay = Delay {
          buffer: Box::new(CircularBuffer::new()),
          delay_samples: ParamSource::from_parts(
            param_1_type,
            param_1_int_val,
            param_1_float_val,
            param_1_float_val_2,
            param_1_float_val_3,
          ),
          wet: ParamSource::from_parts(
            param_2_type,
            param_2_int_val,
            param_2_float_val,
            param_2_float_val_2,
            param_2_float_val_3,
          ),
          dry: ParamSource::from_parts(
            param_3_type,
            param_3_int_val,
            param_3_float_val,
            param_3_float_val_2,
            param_3_float_val_3,
          ),
          feedback: ParamSource::from_parts(
            param_4_type,
            param_4_int_val,
            param_4_float_val,
            param_4_float_val_2,
            param_4_float_val_3,
          ),
        };

        EffectInstance::Delay(delay)
      },
      7 => {
        let moog_filter = MoogFilter::new(
          ParamSource::from_parts(
            param_1_type,
            param_1_int_val,
            param_1_float_val,
            param_1_float_val_2,
            param_1_float_val_3,
          ),
          ParamSource::from_parts(
            param_2_type,
            param_2_int_val,
            param_2_float_val,
            param_2_float_val_2,
            param_2_float_val_3,
          ),
          ParamSource::from_parts(
            param_3_type,
            param_3_int_val,
            param_3_float_val,
            param_3_float_val_2,
            param_3_float_val_3,
          ),
        );

        EffectInstance::MoogFilter(moog_filter)
      },
      8 => {
        let comb_filter = CombFilter {
          input_buffer: Box::new(CircularBuffer::new()),
          feedback_buffer: Box::new(CircularBuffer::new()),
          delay_samples: ParamSource::from_parts(
            param_1_type,
            param_1_int_val,
            param_1_float_val,
            param_1_float_val_2,
            param_1_float_val_3,
          ),
          feedback_delay_samples: ParamSource::from_parts(
            param_2_type,
            param_2_int_val,
            param_2_float_val,
            param_2_float_val_2,
            param_2_float_val_3,
          ),
          feedback_gain: ParamSource::from_parts(
            param_3_type,
            param_3_int_val,
            param_3_float_val,
            param_3_float_val_2,
            param_3_float_val_3,
          ),
          feedforward_gain: ParamSource::from_parts(
            param_4_type,
            param_4_int_val,
            param_4_float_val,
            param_4_float_val_2,
            param_4_float_val_3,
          ),
        };

        EffectInstance::CombFilter(comb_filter)
      },
      9 => {
        let compressor = CompressorEffect {
          cur_frame_ix: 0,
          prev_frame: [0.; FRAME_SIZE],
          inner: MultibandCompressor::default(),
        };

        EffectInstance::Compressor(compressor)
      },
      10 => {
        let mut lfo_phases = [0.; 8];
        for i in 0..lfo_phases.len() {
          lfo_phases[i] = common::rng().gen_range(0., std::f32::consts::PI * 2.);
        }

        let chorus = ChorusEffect {
          buffer: Box::new(CircularBuffer::new()),
          modulation_depth: ParamSource::from_parts(
            param_1_type,
            param_1_int_val,
            param_1_float_val,
            param_1_float_val_2,
            param_1_float_val_3,
          ),
          wet: ParamSource::from_parts(
            param_2_type,
            param_2_int_val,
            param_2_float_val,
            param_2_float_val_2,
            param_2_float_val_3,
          ),
          dry: ParamSource::from_parts(
            param_3_type,
            param_3_int_val,
            param_3_float_val,
            param_3_float_val_2,
            param_3_float_val_3,
          ),
          lfo_phases,
          lfo_rate: ParamSource::from_parts(
            param_4_type,
            param_4_int_val,
            param_4_float_val,
            param_4_float_val_2,
            param_4_float_val_3,
          ),
          last_dry: 0.,
          last_wet: 0.,
          last_modulation_depth: 0.,
          last_lfo_rate: 0.,
        };

        EffectInstance::Chorus(chorus)
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
    param_1_float_val_3: f32,
    param_2_type: usize,
    param_2_int_val: usize,
    param_2_float_val: f32,
    param_2_float_val_2: f32,
    param_2_float_val_3: f32,
    param_3_type: usize,
    param_3_int_val: usize,
    param_3_float_val: f32,
    param_3_float_val_2: f32,
    param_3_float_val_3: f32,
    param_4_type: usize,
    param_4_int_val: usize,
    param_4_float_val: f32,
    param_4_float_val_2: f32,
    param_4_float_val_3: f32,
  ) -> bool {
    match effect_type {
      0 => {
        let spectral_warping = match self {
          EffectInstance::SpectralWarping(spectral_warping) => spectral_warping,
          _ => return false,
        };
        spectral_warping.frequency.replace(ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        ));
        spectral_warping
          .osc
          .stretch_factor
          .replace(ParamSource::from_parts(
            param_2_type,
            param_2_int_val,
            param_2_float_val,
            param_2_float_val_2,
            param_2_float_val_3,
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

        bitcrusher.sample_rate.replace(ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        ));
        bitcrusher.bit_depth.replace(ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        ));
        bitcrusher.mix.replace(ParamSource::from_parts(
          param_3_type,
          param_3_int_val,
          param_3_float_val,
          param_3_float_val_2,
          param_3_float_val_3,
        ));
        return true;
      },
      3 => {
        let wavefolder = match self {
          EffectInstance::Wavefolder(wavefolder) => wavefolder,
          _ => return false,
        };

        wavefolder.gain.replace(ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        ));
        wavefolder.offset.replace(ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        ));
        wavefolder.mix.replace(ParamSource::from_parts(
          param_3_type,
          param_3_int_val,
          param_3_float_val,
          param_3_float_val_2,
          param_3_float_val_3,
        ));
        return true;
      },
      4 => {
        let soft_clipper = match self {
          EffectInstance::SoftClipper(soft_clipper) => soft_clipper,
          _ => return false,
        };

        soft_clipper.pre_gain.replace(ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        ));
        soft_clipper.post_gain.replace(ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        ));
        soft_clipper.mix.replace(ParamSource::from_parts(
          param_3_type,
          param_3_int_val,
          param_3_float_val,
          param_3_float_val_2,
          param_3_float_val_3,
        ));
        soft_clipper.algorithm = unsafe { std::mem::transmute(param_4_int_val as u32) };
        return true;
      },
      5 => {
        let butterworth_filter = match self {
          EffectInstance::ButterworthFilter(butterworth_filter) => butterworth_filter,
          _ => return false,
        };

        let mode = ButterworthFilterMode::from(param_1_int_val);
        let cutoff_freq = ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        );

        butterworth_filter.mode = mode;
        butterworth_filter.cutoff_freq.replace(cutoff_freq);
        return true;
      },
      6 => {
        let delay = match self {
          EffectInstance::Delay(delay) => delay,
          _ => return false,
        };

        delay.delay_samples.replace(ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        ));
        delay.wet.replace(ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        ));
        delay.dry.replace(ParamSource::from_parts(
          param_3_type,
          param_3_int_val,
          param_3_float_val,
          param_3_float_val_2,
          param_3_float_val_3,
        ));
        delay.feedback.replace(ParamSource::from_parts(
          param_4_type,
          param_4_int_val,
          param_4_float_val,
          param_4_float_val_2,
          param_4_float_val_3,
        ));
        return true;
      },
      7 => {
        let moog_filter = match self {
          EffectInstance::MoogFilter(moog_filter) => moog_filter,
          _ => return false,
        };

        moog_filter.cutoff.replace(ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        ));
        moog_filter.resonance.replace(ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        ));
        moog_filter.drive.replace(ParamSource::from_parts(
          param_3_type,
          param_3_int_val,
          param_3_float_val,
          param_3_float_val_2,
          param_3_float_val_3,
        ));
        return true;
      },
      8 => {
        let comb_filter = match self {
          EffectInstance::CombFilter(comb_filter) => comb_filter,
          _ => return false,
        };

        comb_filter.delay_samples.replace(ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        ));
        comb_filter
          .feedback_delay_samples
          .replace(ParamSource::from_parts(
            param_2_type,
            param_2_int_val,
            param_2_float_val,
            param_2_float_val_2,
            param_2_float_val_3,
          ));
        comb_filter.feedback_gain.replace(ParamSource::from_parts(
          param_3_type,
          param_3_int_val,
          param_3_float_val,
          param_3_float_val_2,
          param_3_float_val_3,
        ));
        comb_filter
          .feedforward_gain
          .replace(ParamSource::from_parts(
            param_4_type,
            param_4_int_val,
            param_4_float_val,
            param_4_float_val_2,
            param_4_float_val_3,
          ));
        return true;
      },
      9 => false, // TODO
      10 => {
        let chorus = match self {
          EffectInstance::Chorus(chorus) => chorus,
          _ => return false,
        };

        chorus.modulation_depth.replace(ParamSource::from_parts(
          param_1_type,
          param_1_int_val,
          param_1_float_val,
          param_1_float_val_2,
          param_1_float_val_3,
        ));
        chorus.wet.replace(ParamSource::from_parts(
          param_2_type,
          param_2_int_val,
          param_2_float_val,
          param_2_float_val_2,
          param_2_float_val_3,
        ));
        chorus.dry.replace(ParamSource::from_parts(
          param_3_type,
          param_3_int_val,
          param_3_float_val,
          param_3_float_val_2,
          param_3_float_val_3,
        ));
        chorus.lfo_rate.replace(ParamSource::from_parts(
          param_4_type,
          param_4_int_val,
          param_4_float_val,
          param_4_float_val_2,
          param_4_float_val_3,
        ));
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
      EffectInstance::ButterworthFilter(e) => e.apply(rendered_params, base_frequency, sample),
      EffectInstance::Delay(e) => e.apply(rendered_params, base_frequency, sample),
      EffectInstance::MoogFilter(e) => e.apply(rendered_params, base_frequency, sample),
      EffectInstance::CombFilter(e) => e.apply(rendered_params, base_frequency, sample),
      EffectInstance::Compressor(e) => e.apply(rendered_params, base_frequency, sample),
      EffectInstance::Chorus(e) => e.apply(rendered_params, base_frequency, sample),
    }
  }

  fn apply_all(
    &mut self,
    rendered_params: &[[f32; FRAME_SIZE]],
    base_frequencies: &[f32; FRAME_SIZE],
    samples: &mut [f32; FRAME_SIZE],
  ) {
    match self {
      EffectInstance::SpectralWarping(e) => e.apply_all(rendered_params, base_frequencies, samples),
      EffectInstance::Wavecruncher(e) => e.apply_all(rendered_params, base_frequencies, samples),
      EffectInstance::Bitcrusher(e) => e.apply_all(rendered_params, base_frequencies, samples),
      EffectInstance::Wavefolder(e) => e.apply_all(rendered_params, base_frequencies, samples),
      EffectInstance::SoftClipper(e) => e.apply_all(rendered_params, base_frequencies, samples),
      EffectInstance::ButterworthFilter(e) =>
        e.apply_all(rendered_params, base_frequencies, samples),
      EffectInstance::Delay(e) => e.apply_all(rendered_params, base_frequencies, samples),
      EffectInstance::MoogFilter(e) => e.apply_all(rendered_params, base_frequencies, samples),
      EffectInstance::CombFilter(e) => e.apply_all(rendered_params, base_frequencies, samples),
      EffectInstance::Compressor(e) => e.apply_all(rendered_params, base_frequencies, samples),
      EffectInstance::Chorus(e) => e.apply_all(rendered_params, base_frequencies, samples),
    }
  }

  fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut ParamSource>; MAX_PARAM_COUNT]) {
    match self {
      EffectInstance::SpectralWarping(e) => e.get_params(buf),
      EffectInstance::Wavecruncher(e) => e.get_params(buf),
      EffectInstance::Bitcrusher(e) => e.get_params(buf),
      EffectInstance::Wavefolder(e) => e.get_params(buf),
      EffectInstance::SoftClipper(e) => e.get_params(buf),
      EffectInstance::ButterworthFilter(e) => e.get_params(buf),
      EffectInstance::Delay(e) => e.get_params(buf),
      EffectInstance::MoogFilter(e) => e.get_params(buf),
      EffectInstance::CombFilter(e) => e.get_params(buf),
      EffectInstance::Compressor(e) => e.get_params(buf),
      EffectInstance::Chorus(e) => e.get_params(buf),
    }
  }

  fn reset(&mut self) {
    match self {
      EffectInstance::SpectralWarping(e) => e.reset(),
      EffectInstance::Wavecruncher(e) => e.reset(),
      EffectInstance::Bitcrusher(e) => e.reset(),
      EffectInstance::Wavefolder(e) => e.reset(),
      EffectInstance::SoftClipper(e) => e.reset(),
      EffectInstance::ButterworthFilter(e) => e.reset(),
      EffectInstance::Delay(e) => e.reset(),
      EffectInstance::MoogFilter(e) => e.reset(),
      EffectInstance::CombFilter(e) => e.reset(),
      EffectInstance::Compressor(e) => e.reset(),
      EffectInstance::Chorus(e) => e.reset(),
    }
  }
}

#[derive(Clone)]
pub struct EffectContainer {
  pub inst: Box<EffectInstance>,
  pub is_bypassed: bool,
}

const MAX_EFFECT_COUNT: usize = 16;
const MAX_PARAM_COUNT: usize = 4;

#[derive(Clone)]
pub struct EffectChain {
  effects: [Option<EffectContainer>; MAX_EFFECT_COUNT],
  param_render_buf: Box<[[[f32; FRAME_SIZE]; MAX_PARAM_COUNT]; MAX_EFFECT_COUNT]>,
}

impl Default for EffectChain {
  fn default() -> Self {
    EffectChain {
      effects: [
        None, None, None, None, None, None, None, None, None, None, None, None, None, None, None,
        None,
      ],
      param_render_buf: Box::new(uninit()),
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
    param_1_float_val_3: f32,
    param_2_type: usize,
    param_2_int_val: usize,
    param_2_float_val: f32,
    param_2_float_val_2: f32,
    param_2_float_val_3: f32,
    param_3_type: usize,
    param_3_int_val: usize,
    param_3_float_val: f32,
    param_3_float_val_2: f32,
    param_3_float_val_3: f32,
    param_4_type: usize,
    param_4_int_val: usize,
    param_4_float_val: f32,
    param_4_float_val_2: f32,
    param_4_float_val_3: f32,
    is_bypassed: bool,
  ) {
    if let Some(effect) = &mut self.effects[effect_ix] {
      let successfully_updated = effect.inst.maybe_update_from_parts(
        effect_type,
        param_1_type,
        param_1_int_val,
        param_1_float_val,
        param_1_float_val_2,
        param_1_float_val_3,
        param_2_type,
        param_2_int_val,
        param_2_float_val,
        param_2_float_val_2,
        param_2_float_val_3,
        param_3_type,
        param_3_int_val,
        param_3_float_val,
        param_3_float_val_2,
        param_3_float_val_3,
        param_4_type,
        param_4_int_val,
        param_4_float_val,
        param_4_float_val_2,
        param_4_float_val_3,
      );
      if successfully_updated {
        effect.is_bypassed = is_bypassed;
        return;
      }
    }

    self.effects[effect_ix] = Some(EffectContainer {
      inst: Box::new(EffectInstance::from_parts(
        effect_type,
        param_1_type,
        param_1_int_val,
        param_1_float_val,
        param_1_float_val_2,
        param_1_float_val_3,
        param_2_type,
        param_2_int_val,
        param_2_float_val,
        param_2_float_val_2,
        param_2_float_val_3,
        param_3_type,
        param_3_int_val,
        param_3_float_val,
        param_3_float_val_2,
        param_3_float_val_3,
        param_4_type,
        param_4_int_val,
        param_4_float_val,
        param_4_float_val_2,
        param_4_float_val_3,
      )),
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

  pub fn reset(&mut self) {
    for effect in self.effects.iter_mut() {
      if let Some(effect) = effect {
        effect.inst.reset();
      }
    }
  }
}

/// Given an arbitrary effect, queries the effect for its current list of parameters.  Then, renders
/// the output of each of those parameters into a set of buffers.
fn render_effect_params<'a, E: Effect>(
  effect: &mut E,
  buffers: &mut [[f32; FRAME_SIZE]; 4],
  inputs: &RenderRawParams<'a>,
) {
  let mut params: [Option<&mut ParamSource>; MAX_PARAM_COUNT] = [None, None, None, None];
  effect.get_params(&mut params);

  for (i, param) in params.into_iter().enumerate() {
    let Some(param) = param else { return };
    let output_buf = unsafe { buffers.get_unchecked_mut(i) };
    param.render_raw(inputs, output_buf)
  }
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
        None => return,
      };

      let buffers = unsafe { self.param_render_buf.get_unchecked_mut(effect_ix) };
      render_effect_params(&mut **effect, buffers, render_params);
    }
  }

  fn get_rendered_param(
    param_render_buf: &[[[f32; FRAME_SIZE]; MAX_PARAM_COUNT]; MAX_EFFECT_COUNT],
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

    let mut params_for_sample: [f32; MAX_PARAM_COUNT] = uninit();
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

      for param_ix in 0..MAX_PARAM_COUNT {
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
    for (effect_ix, effect) in self.effects.iter_mut().enumerate() {
      let effect = match effect {
        Some(effect_container) =>
          if effect_container.is_bypassed {
            continue;
          } else {
            &mut effect_container.inst
          },
        None => return,
      };

      let rendered_params = &self.param_render_buf[effect_ix];
      effect.apply_all(rendered_params, &render_params.base_frequencies, samples);
    }
  }
}
