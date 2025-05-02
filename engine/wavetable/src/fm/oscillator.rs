use std::cell::Cell;

use adsr::Adsr;
use dsp::{oscillator::PhasedOscillator, FRAME_SIZE};

use crate::WaveTable;

use super::param_source::ParamSource;

pub trait Oscillator {
  fn gen_sample(
    &mut self,
    frequency: f32,
    wavetables: &[WaveTable],
    param_buffers: &[[f32; FRAME_SIZE]],
    adsrs: &[Adsr],
    sample_ix_within_frame: usize,
    base_frequency: f32,
  ) -> f32;
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
  fn gen_sample(
    &mut self,
    frequency: f32,
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
      out += dsp::read_interpolated(
        sine_lookup_table,
        phase * (sine_lookup_table.len() - 2) as f32,
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
}

impl Default for SquareOscillator {
  fn default() -> Self {
    SquareOscillator {
      duty_cycle: ParamSource::Constant {
        last_val: Cell::new(0.5),
        cur_val: 0.5,
      },
      phase: 0.,
    }
  }
}

impl PhasedOscillator for SquareOscillator {
  fn get_phase(&self) -> f32 { self.phase }

  fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl Oscillator for SquareOscillator {
  fn gen_sample(
    &mut self,
    frequency: f32,
    _wavetables: &[WaveTable],
    param_buffers: &[[f32; FRAME_SIZE]],
    adsrs: &[Adsr],
    sample_ix_within_frame: usize,
    base_frequency: f32,
  ) -> f32 {
    // 4x oversampling to avoid aliasing
    let mut out = 0.;
    let mut phase = self.phase;
    let duty_cycle =
      self
        .duty_cycle
        .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);
    let duty_cycle = dsp::clamp(0.0001, 0.9999, duty_cycle);

    phase = Self::compute_new_phase_oversampled(phase, 4., frequency);
    out += if phase < duty_cycle { 0.25 } else { -0.25 };
    phase = Self::compute_new_phase_oversampled(phase, 4., frequency);
    out += if phase < duty_cycle { 0.25 } else { -0.25 };
    phase = Self::compute_new_phase_oversampled(phase, 4., frequency);
    out += if phase < duty_cycle { 0.25 } else { -0.25 };
    phase = Self::compute_new_phase_oversampled(phase, 4., frequency);
    out += if phase < duty_cycle { 0.25 } else { -0.25 };

    self.phase = phase;

    out
  }
}

#[derive(Clone, Default)]
pub struct TriangleOscillator {
  pub phase: f32,
}

impl PhasedOscillator for TriangleOscillator {
  fn get_phase(&self) -> f32 { self.phase }

  fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl Oscillator for TriangleOscillator {
  fn gen_sample(
    &mut self,
    frequency: f32,
    _wavetables: &[WaveTable],
    _param_buffers: &[[f32; FRAME_SIZE]],
    _adsrs: &[Adsr],
    _sample_ix_within_frame: usize,
    _base_frequency: f32,
  ) -> f32 {
    // 4x oversampling to avoid aliasing
    let oversample_factor = 4usize;
    let mut out = 0.;
    let mut phase = self.phase;
    for _ in 0..oversample_factor {
      phase = Self::compute_new_phase_oversampled(phase, oversample_factor as f32, frequency);
      out += if phase < 0.25 {
        4. * phase
      } else if phase < 0.5 {
        let adjusted_phase = phase - 0.25;
        1. - 4. * adjusted_phase
      } else if phase < 0.75 {
        let adjusted_phase = phase - 0.5;
        -adjusted_phase * 4.
      } else {
        let adjusted_phase = phase - 0.75;
        -1. + (adjusted_phase * 4.)
      }
    }

    self.phase = phase;
    out / oversample_factor as f32
  }
}

#[derive(Clone, Default)]
pub struct SawtoothOscillator {
  pub phase: f32,
}

impl PhasedOscillator for SawtoothOscillator {
  fn get_phase(&self) -> f32 { self.phase }

  fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl Oscillator for SawtoothOscillator {
  fn gen_sample(
    &mut self,
    frequency: f32,
    _wavetables: &[WaveTable],
    _param_buffers: &[[f32; FRAME_SIZE]],
    _adsrs: &[Adsr],
    _sample_ix_within_frame: usize,
    _base_frequency: f32,
  ) -> f32 {
    // 4x oversampling to reduce aliasing
    let oversample_factor = 4usize;
    let mut out = 0.;
    let mut phase = self.phase;
    for _ in 0..oversample_factor {
      phase = Self::compute_new_phase_oversampled(phase, oversample_factor as f32, frequency);
      out += if phase < 0.5 {
        2. * phase
      } else {
        -1. + (2. * (phase - 0.5))
      };
    }

    self.phase = phase;
    out / oversample_factor as f32
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
