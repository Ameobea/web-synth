use std::cell::Cell;

use adsr::Adsr;
use dsp::{oscillator::PhasedOscillator, FRAME_SIZE};

use crate::WaveTable;

use super::param_source::ParamSource;

const FIR_COEFFS: [f32; 31] = [
  -1.20388000e-03,
  -2.05336094e-03,
  -2.07962901e-03,
  1.64050411e-18,
  4.76490069e-03,
  9.89603364e-03,
  9.97846427e-03,
  -4.80775224e-18,
  -1.89637895e-02,
  -3.62933212e-02,
  -3.47620350e-02,
  8.28597812e-18,
  6.86322821e-02,
  1.53265764e-01,
  2.23458463e-01,
  2.50720214e-01,
  2.23458463e-01,
  1.53265764e-01,
  6.86322821e-02,
  8.28597812e-18,
  -3.47620350e-02,
  -3.62933212e-02,
  -1.89637895e-02,
  -4.80775224e-18,
  9.97846427e-03,
  9.89603364e-03,
  4.76490069e-03,
  1.64050411e-18,
  -2.07962901e-03,
  -2.05336094e-03,
  -1.20388000e-03,
];

const FIR_TAP_COUNT: usize = const { FIR_COEFFS.len() };

#[derive(Clone)]
pub struct FirDownsampler {
  buf: [f32; FIR_TAP_COUNT],
  pos: usize,
}

impl Default for FirDownsampler {
  fn default() -> Self {
    FirDownsampler {
      buf: [0.; FIR_TAP_COUNT],
      pos: 0,
    }
  }
}

const ENABLE_FIR_DOWNSAMPLER: bool = true;

impl FirDownsampler {
  #[inline]
  fn push(&mut self, sample: f32) {
    self.buf[self.pos] = sample;
    self.pos = (self.pos + 1) % FIR_TAP_COUNT;
  }

  #[inline]
  fn compute(&self) -> f32 {
    let mut out = 0.0;
    for i in 0..FIR_TAP_COUNT {
      let index = (self.pos + i) % FIR_TAP_COUNT;
      out += self.buf[index] * FIR_COEFFS[i];
    }
    out
  }

  #[inline]
  pub fn downsample(&mut self, input: &[f32; 4]) -> f32 {
    if !ENABLE_FIR_DOWNSAMPLER {
      return (input[0] + input[1] + input[2] + input[3]) / 4.;
    }

    self.push(input[0]);
    self.push(input[1]);
    self.push(input[2]);
    self.push(input[3]);

    self.compute()
  }
}

pub trait Oscillator {
  fn gen_sample_with_phase_mod(
    &mut self,
    frequency: f32,
    phase_modulation: f32,
    wavetables: &[WaveTable],
    param_buffers: &[[f32; FRAME_SIZE]],
    adsrs: &[Adsr],
    sample_ix_within_frame: usize,
    base_frequency: f32,
  ) -> f32;

  fn gen_sample(
    &mut self,
    frequency: f32,
    wavetables: &[WaveTable],
    param_buffers: &[[f32; FRAME_SIZE]],
    adsrs: &[Adsr],
    sample_ix_within_frame: usize,
    base_frequency: f32,
  ) -> f32 {
    self.gen_sample_with_phase_mod(
      frequency,
      0.0,
      wavetables,
      param_buffers,
      adsrs,
      sample_ix_within_frame,
      base_frequency,
    )
  }
}

#[derive(Clone, Default)]
pub struct SineOscillator {
  pub phase: f32,
}

impl PhasedOscillator for SineOscillator {
  fn get_phase(&self) -> f32 { self.phase }

  fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl Oscillator for SineOscillator {
  fn gen_sample_with_phase_mod(
    &mut self,
    frequency: f32,
    phase_modulation: f32,
    _wavetables: &[WaveTable],
    _param_buffers: &[[f32; FRAME_SIZE]],
    _adsrs: &[Adsr],
    _sample_ix_within_frame: usize,
    _base_frequency: f32,
  ) -> f32 {
    let sine_lookup_table = dsp::lookup_tables::get_sine_lookup_table();

    // 4x oversampling to avoid aliasing
    let mut out = 0.;
    let mut phase = self.phase;
    let oversample_ratio = 4usize;
    for _ in 0..oversample_ratio {
      phase = Self::compute_new_phase_oversampled(phase, oversample_ratio as f32, frequency);
      let mut lookup_phase = phase + phase_modulation;
      lookup_phase -= lookup_phase.floor();
      out += dsp::read_interpolated(
        sine_lookup_table,
        lookup_phase * (sine_lookup_table.len() - 1) as f32,
      );
    }

    self.phase = phase;
    out / oversample_ratio as f32
  }
}

#[derive(Clone)]
pub struct SquareOscillator {
  pub duty_cycle: ParamSource,
  pub phase: f32,
  pub fir_downsampler: FirDownsampler,
}

impl Default for SquareOscillator {
  fn default() -> Self {
    SquareOscillator {
      duty_cycle: ParamSource::Constant {
        last_val: Cell::new(0.5),
        cur_val: 0.5,
      },
      phase: 0.,
      fir_downsampler: FirDownsampler::default(),
    }
  }
}

impl PhasedOscillator for SquareOscillator {
  fn get_phase(&self) -> f32 { self.phase }

  fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl Oscillator for SquareOscillator {
  fn gen_sample_with_phase_mod(
    &mut self,
    frequency: f32,
    phase_modulation: f32,
    _wavetables: &[WaveTable],
    param_buffers: &[[f32; FRAME_SIZE]],
    adsrs: &[Adsr],
    sample_ix_within_frame: usize,
    base_frequency: f32,
  ) -> f32 {
    // 4x oversampling to avoid aliasing
    let mut phase = self.phase;
    let duty_cycle =
      self
        .duty_cycle
        .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);
    let duty_cycle = dsp::clamp(0.0001, 0.9999, duty_cycle);

    phase = Self::compute_new_phase_oversampled(phase, 4., frequency);
    let mut mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s0 = if mod_phase < duty_cycle { 1. } else { -1. };

    phase = Self::compute_new_phase_oversampled(phase, 4., frequency);
    mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s1 = if mod_phase < duty_cycle { 1. } else { -1. };

    phase = Self::compute_new_phase_oversampled(phase, 4., frequency);
    mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s2 = if mod_phase < duty_cycle { 1. } else { -1. };

    phase = Self::compute_new_phase_oversampled(phase, 4., frequency);
    mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s3 = if mod_phase < duty_cycle { 1. } else { -1. };

    self.phase = phase;

    self.fir_downsampler.downsample(&[s0, s1, s2, s3])
  }
}

#[derive(Clone, Default)]
pub struct TriangleOscillator {
  pub phase: f32,
  pub fir_downsampler: FirDownsampler,
}

impl PhasedOscillator for TriangleOscillator {
  fn get_phase(&self) -> f32 { self.phase }

  fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl Oscillator for TriangleOscillator {
  fn gen_sample_with_phase_mod(
    &mut self,
    frequency: f32,
    phase_modulation: f32,
    _wavetables: &[WaveTable],
    _param_buffers: &[[f32; FRAME_SIZE]],
    _adsrs: &[Adsr],
    _sample_ix_within_frame: usize,
    _base_frequency: f32,
  ) -> f32 {
    // 4x oversampling to avoid aliasing
    let oversample_factor = 4usize;
    let mut phase = self.phase;

    phase = Self::compute_new_phase_oversampled(phase, oversample_factor as f32, frequency);
    let mut mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s0 = if mod_phase < 0.25 {
      4. * mod_phase
    } else if mod_phase < 0.5 {
      let adjusted_phase = mod_phase - 0.25;
      1. - 4. * adjusted_phase
    } else if mod_phase < 0.75 {
      let adjusted_phase = mod_phase - 0.5;
      -adjusted_phase * 4.
    } else {
      let adjusted_phase = mod_phase - 0.75;
      -1. + (adjusted_phase * 4.)
    };

    phase = Self::compute_new_phase_oversampled(phase, oversample_factor as f32, frequency);
    mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s1 = if mod_phase < 0.25 {
      4. * mod_phase
    } else if mod_phase < 0.5 {
      let adjusted_phase = mod_phase - 0.25;
      1. - 4. * adjusted_phase
    } else if mod_phase < 0.75 {
      let adjusted_phase = mod_phase - 0.5;
      -adjusted_phase * 4.
    } else {
      let adjusted_phase = mod_phase - 0.75;
      -1. + (adjusted_phase * 4.)
    };

    phase = Self::compute_new_phase_oversampled(phase, oversample_factor as f32, frequency);
    mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s2 = if mod_phase < 0.25 {
      4. * mod_phase
    } else if mod_phase < 0.5 {
      let adjusted_phase = mod_phase - 0.25;
      1. - 4. * adjusted_phase
    } else if mod_phase < 0.75 {
      let adjusted_phase = mod_phase - 0.5;
      -adjusted_phase * 4.
    } else {
      let adjusted_phase = mod_phase - 0.75;
      -1. + (adjusted_phase * 4.)
    };

    phase = Self::compute_new_phase_oversampled(phase, oversample_factor as f32, frequency);
    mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s3 = if mod_phase < 0.25 {
      4. * mod_phase
    } else if mod_phase < 0.5 {
      let adjusted_phase = mod_phase - 0.25;
      1. - 4. * adjusted_phase
    } else if mod_phase < 0.75 {
      let adjusted_phase = mod_phase - 0.5;
      -adjusted_phase * 4.
    } else {
      let adjusted_phase = mod_phase - 0.75;
      -1. + (adjusted_phase * 4.)
    };

    self.phase = phase;
    self.fir_downsampler.downsample(&[s0, s1, s2, s3])
  }
}

#[derive(Clone, Default)]
pub struct SawtoothOscillator {
  pub phase: f32,
  pub fir_downsampler: FirDownsampler,
}

impl PhasedOscillator for SawtoothOscillator {
  fn get_phase(&self) -> f32 { self.phase }

  fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl Oscillator for SawtoothOscillator {
  fn gen_sample_with_phase_mod(
    &mut self,
    frequency: f32,
    phase_modulation: f32,
    _wavetables: &[WaveTable],
    _param_buffers: &[[f32; FRAME_SIZE]],
    _adsrs: &[Adsr],
    _sample_ix_within_frame: usize,
    _base_frequency: f32,
  ) -> f32 {
    // 4x oversampling to reduce aliasing
    let oversample_factor = 4usize;
    let mut phase = self.phase;

    phase = Self::compute_new_phase_oversampled(phase, oversample_factor as f32, frequency);
    let mut mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s0 = if mod_phase < 0.5 {
      2. * mod_phase
    } else {
      -1. + (2. * (mod_phase - 0.5))
    };

    phase = Self::compute_new_phase_oversampled(phase, oversample_factor as f32, frequency);
    mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s1 = if mod_phase < 0.5 {
      2. * mod_phase
    } else {
      -1. + (2. * (mod_phase - 0.5))
    };

    phase = Self::compute_new_phase_oversampled(phase, oversample_factor as f32, frequency);
    mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s2 = if mod_phase < 0.5 {
      2. * mod_phase
    } else {
      -1. + (2. * (mod_phase - 0.5))
    };

    phase = Self::compute_new_phase_oversampled(phase, oversample_factor as f32, frequency);
    mod_phase = phase + phase_modulation;
    mod_phase -= mod_phase.floor();
    let s3 = if mod_phase < 0.5 {
      2. * mod_phase
    } else {
      -1. + (2. * (mod_phase - 0.5))
    };

    self.phase = phase;
    self.fir_downsampler.downsample(&[s0, s1, s2, s3])
  }
}

#[derive(Clone)]
pub struct ExponentialOscillator {
  pub phase: f32,
  pub stretch_factor: ParamSource,
}

impl ExponentialOscillator {
  pub fn new(stretch_factor: ParamSource) -> Self {
    ExponentialOscillator {
      phase: 0.,
      stretch_factor,
    }
  }
}

impl PhasedOscillator for ExponentialOscillator {
  fn get_phase(&self) -> f32 { self.phase }

  fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl ExponentialOscillator {
  #[inline(never)]
  pub fn gen_sample_with_stretch_factor(&mut self, frequency: f32, stretch_factor: f32) -> f32 {
    self.update_phase(frequency);
    let stretch_factor = dsp::clamp(0., 1., stretch_factor);

    let exponent_numerator = 10.0f32.powf(4.0 * (stretch_factor * 0.8 + 0.35)) + 1.;
    // let exponent_numerator = even_faster_pow(10.0f32, 4.0 * (stretch_factor * 0.8 + 0.35)) +
    // 1.;
    let exponent_denominator = 999.0f32;
    let exponent = exponent_numerator / exponent_denominator;

    // Transform phase into [-1, 1] range
    let extended_phase = self.phase * 2. - 1.;
    let absolute_phase = extended_phase.abs();
    debug_assert!(absolute_phase >= 0.);
    debug_assert!(absolute_phase <= 1.);

    // val is from 0 to 1
    let val = if cfg!(debug_assertions) {
      let val = absolute_phase.powf(exponent);
      debug_assert!(val >= -1.);
      debug_assert!(val <= 1.);
      val
    } else {
      dsp::clamp(-1., 1., super::fast::pow(absolute_phase, exponent))
    };

    // Re-apply sign
    // output is from -1 to 1
    val * extended_phase.signum()
  }

  pub fn gen_sample_with_phase_mod(
    &mut self,
    frequency: f32,
    phase_modulation: f32,
    param_buffers: &[[f32; FRAME_SIZE]],
    adsrs: &[Adsr],
    sample_ix_within_frame: usize,
    base_frequency: f32,
  ) -> f32 {
    self.update_phase(frequency);

    let stretch_factor =
      self
        .stretch_factor
        .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);

    let stretch_factor = dsp::clamp(0., 1., stretch_factor);

    let exponent_numerator = 10.0f32.powf(4.0 * (stretch_factor * 0.8 + 0.35)) + 1.;
    let exponent_denominator = 999.0f32;
    let exponent = exponent_numerator / exponent_denominator;

    // Apply phase modulation
    let mut phase = self.phase + phase_modulation;
    phase -= phase.floor();

    // Transform phase into [-1, 1] range
    let extended_phase = phase * 2. - 1.;
    let absolute_phase = extended_phase.abs();

    let val = if cfg!(debug_assertions) {
      let val = absolute_phase.powf(exponent);
      val
    } else {
      dsp::clamp(-1., 1., super::fast::pow(absolute_phase, exponent))
    };

    val * extended_phase.signum()
  }

  pub fn gen_sample(
    &mut self,
    frequency: f32,
    param_buffers: &[[f32; FRAME_SIZE]],
    adsrs: &[Adsr],
    sample_ix_within_frame: usize,
    base_frequency: f32,
  ) -> f32 {
    self.update_phase(frequency);

    let stretch_factor =
      self
        .stretch_factor
        .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);

    self.gen_sample_with_stretch_factor(frequency, stretch_factor)
  }
}
