use std::cell::Cell;

use dsp::{lookup_tables::maybe_init_lookup_tables, oscillator::PhasedOscillator, FRAME_SIZE};
use wavetable::fm::{
  oscillator::{
    Oscillator, SawtoothOscillator, SineOscillator, SquareOscillator, TriangleOscillator,
  },
  param_source::ParamSource,
};

pub enum OscillatorInst {
  Sine(SineOscillator),
  Triangle(TriangleOscillator),
  Square(SquareOscillator),
  Sawtooth(SawtoothOscillator),
}

impl OscillatorInst {
  pub fn get_phase(&self) -> f32 {
    match self {
      OscillatorInst::Sine(osc) => osc.get_phase(),
      OscillatorInst::Triangle(osc) => osc.get_phase(),
      OscillatorInst::Square(osc) => osc.get_phase(),
      OscillatorInst::Sawtooth(osc) => osc.get_phase(),
    }
  }

  pub fn set_phase(&mut self, new_phase: f32) {
    match self {
      OscillatorInst::Sine(osc) => osc.set_phase(new_phase),
      OscillatorInst::Triangle(osc) => osc.set_phase(new_phase),
      OscillatorInst::Square(osc) => osc.set_phase(new_phase),
      OscillatorInst::Sawtooth(osc) => osc.set_phase(new_phase),
    }
  }

  pub fn set(&mut self, osc_type: OscillatorType, param0: f32) {
    let phase = self.get_phase();
    match osc_type {
      OscillatorType::Sine => {
        *self = OscillatorInst::Sine(SineOscillator { phase });
      },
      OscillatorType::Triangle => {
        *self = OscillatorInst::Triangle(TriangleOscillator {
          phase,
          fir_downsampler: Default::default(),
        });
      },
      OscillatorType::Square =>
        if let OscillatorInst::Square(ref mut osc) = *self {
          osc.phase = phase;
          match &mut osc.duty_cycle {
            ParamSource::Constant { cur_val, .. } => {
              *cur_val = param0;
            },
            _ => unreachable!(),
          }
        } else {
          *self = OscillatorInst::Square(SquareOscillator {
            phase,
            duty_cycle: ParamSource::Constant {
              last_val: Cell::new(param0),
              cur_val: param0,
            },
            fir_downsampler: Default::default(),
          });
        },
      OscillatorType::Sawtooth => {
        *self = OscillatorInst::Sawtooth(SawtoothOscillator {
          phase,
          fir_downsampler: Default::default(),
        });
      },
    }
  }

  pub fn process(
    &mut self,
    freq_input_buf: &[f32; FRAME_SIZE],
    output_buf: &mut [f32; FRAME_SIZE],
  ) {
    fn process_generic<T: Oscillator + PhasedOscillator>(
      osc: &mut T,
      freq_input_buf: &[f32; FRAME_SIZE],
      output_buf: &mut [f32; FRAME_SIZE],
    ) {
      for i in 0..FRAME_SIZE {
        let freq = freq_input_buf[i];
        output_buf[i] = osc.gen_sample(freq, &[], &[], &[], i, freq);
      }
    }

    match self {
      OscillatorInst::Sine(osc) => process_generic(osc, freq_input_buf, output_buf),
      OscillatorInst::Triangle(osc) => process_generic(osc, freq_input_buf, output_buf),
      OscillatorInst::Square(osc) => process_generic(osc, freq_input_buf, output_buf),
      OscillatorInst::Sawtooth(osc) => process_generic(osc, freq_input_buf, output_buf),
    }
  }
}

pub struct LfoCtx {
  pub osc: OscillatorInst,
  pub freq_input_buf: [f32; FRAME_SIZE],
  pub output_buf: [f32; FRAME_SIZE],
  pub reset_phase_on_playback_start: bool,
  pub start_phase: f32,
}

impl Default for LfoCtx {
  fn default() -> Self {
    Self {
      osc: OscillatorInst::Sine(SineOscillator::default()),
      freq_input_buf: [0.; FRAME_SIZE],
      output_buf: [0.; FRAME_SIZE],
      reset_phase_on_playback_start: false,
      start_phase: 0.,
    }
  }
}

#[no_mangle]
pub extern "C" fn lfo_init() -> *mut LfoCtx {
  maybe_init_lookup_tables();
  Box::into_raw(Box::new(LfoCtx::default()))
}

pub enum OscillatorType {
  Sine = 0,
  Triangle = 1,
  Square = 2,
  Sawtooth = 3,
}

impl OscillatorType {
  pub fn from_usize(value: usize) -> Self {
    match value {
      0 => OscillatorType::Sine,
      1 => OscillatorType::Triangle,
      2 => OscillatorType::Square,
      3 => OscillatorType::Sawtooth,
      _ => panic!("Invalid oscillator type: {value}"),
    }
  }
}

#[no_mangle]
pub extern "C" fn lfo_set_oscillator_type(ctx: *mut LfoCtx, osc_type: usize, param0: f32) {
  let ctx = unsafe { &mut *ctx };

  let osc_type = OscillatorType::from_usize(osc_type);
  ctx.osc.set(osc_type, param0);
}

#[no_mangle]
pub extern "C" fn lfo_set_phase_init(
  ctx: *mut LfoCtx,
  reset_phase_on_playback_start: bool,
  start_phase: f32,
) {
  let ctx = unsafe { &mut *ctx };
  ctx.reset_phase_on_playback_start = reset_phase_on_playback_start;
  ctx.start_phase = start_phase;
}

#[no_mangle]
pub extern "C" fn lfo_on_playback_start(
  ctx: *mut LfoCtx,
  cur_bpm: f32,
  start_beat: f32,
  cur_freq: f32,
) {
  let ctx = unsafe { &mut *ctx };
  if ctx.reset_phase_on_playback_start {
    // set phase as if the oscillator was initialized to `start_phase` at beat=0 and has been
    // playing at `cur_freq` for `start_beat` beats at `cur_bpm`
    let elapsed_seconds = start_beat * 60. / cur_bpm;
    let elapsed_cycles = cur_freq * elapsed_seconds;
    let computed_start_phase = (ctx.start_phase + elapsed_cycles) % 1.;

    ctx.osc.set_phase(computed_start_phase);
  }
}

#[no_mangle]
pub extern "C" fn lfo_get_freq_input_buf_ptr(ctx: *mut LfoCtx) -> *mut f32 {
  let ctx = unsafe { &mut *ctx };
  ctx.freq_input_buf.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn lfo_get_output_buf_ptr(ctx: *mut LfoCtx) -> *mut f32 {
  let ctx = unsafe { &mut *ctx };
  ctx.output_buf.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn lfo_process(ctx: *mut LfoCtx) {
  let ctx = unsafe { &mut *ctx };
  ctx.osc.process(&ctx.freq_input_buf, &mut ctx.output_buf);
}

#[no_mangle]
pub extern "C" fn lfo_get_phase(ctx: *mut LfoCtx) -> f32 {
  let ctx = unsafe { &mut *ctx };
  ctx.osc.get_phase()
}

#[no_mangle]
pub extern "C" fn lfo_set_phase(ctx: *mut LfoCtx, phase: f32) {
  let ctx = unsafe { &mut *ctx };
  ctx.osc.set_phase(phase);
}
