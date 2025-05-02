#[cfg(feature = "simd")]
use std::arch::wasm32::*;
use std::cell::Cell;

use adsr::Adsr;
use dsp::{FRAME_SIZE, SAMPLE_RATE};
use rand::Rng;

pub const MAX_MIDI_CONTROL_VALUE_COUNT: usize = 1024;
pub static mut MIDI_CONTROL_VALUES: [f32; MAX_MIDI_CONTROL_VALUE_COUNT] =
  [0.; MAX_MIDI_CONTROL_VALUE_COUNT];

#[derive(Clone, Default, PartialEq)]
pub struct AdsrState {
  pub adsr_ix: usize,
  pub scale: f32,
  pub shift: f32,
}

#[derive(Clone, PartialEq)]
pub enum ParamSource {
  /// Each sample, the value for this param is pulled out of the parameter buffer of this index.
  /// These buffers are populated externally every frame.
  ParamBuffer(usize),
  /// Built-in smoothing to prevent clicks and pops when sliders are dragged around in the UI
  Constant {
    last_val: Cell<f32>,
    cur_val: f32,
  },
  /// The value of this parameter is determined by the output of a per-voice ADSR that is
  /// triggered every time that voice is triggered.
  PerVoiceADSR(AdsrState),
  BaseFrequencyMultiplier {
    multiplier: f32,
    offset_hz: f32,
  },
  MIDIControlValue {
    control_index: usize,
    scale: f32,
    shift: f32,
  },
  /// Converts the provided number of beats into samples.  If the cur BPM is 60, that equates to
  /// 1 beat per second which comes out to 44_100 samples.
  BeatsToSamples(f32),
  Random {
    last_val: Cell<f32>,
    target_val: Cell<f32>,
    samples_since_last_update: Cell<usize>,
    min: f32,
    max: f32,
    update_interval_samples: usize,
    smoothing_coefficient: f32,
  },
}

#[derive(Clone)]
pub struct AdsrParams {
  pub len_samples: ParamSource,
}

impl ParamSource {
  pub fn new_constant(val: f32) -> Self {
    ParamSource::Constant {
      last_val: Cell::new(val),
      cur_val: val,
    }
  }

  pub fn replace(&mut self, new: Self) {
    match new {
      ParamSource::Constant {
        cur_val: new_val, ..
      } => match self {
        ParamSource::Constant {
          last_val: _,
          cur_val: old_cur_val,
        } => {
          *old_cur_val = new_val;
        },
        other => *other = new,
      },
      ParamSource::Random {
        min,
        max,
        update_interval_samples,
        smoothing_coefficient,
        ..
      } => match self {
        ParamSource::Random {
          min: old_min,
          max: old_max,
          update_interval_samples: old_update_interval_samples,
          smoothing_coefficient: old_smoothing_coefficient,
          ..
        } => {
          *old_min = min;
          *old_max = max;
          *old_update_interval_samples = update_interval_samples;
          *old_smoothing_coefficient = smoothing_coefficient;
        },
        other => *other = new,
      },
      _ => *self = new,
    }
  }
}

pub struct RenderRawParams<'a> {
  pub param_buffers: &'a [[f32; FRAME_SIZE]],
  pub adsrs: &'a [Adsr],
  pub base_frequencies: &'a [f32; FRAME_SIZE],
}

impl Default for ParamSource {
  fn default() -> Self {
    ParamSource::Constant {
      last_val: Cell::new(0.),
      cur_val: 0.,
    }
  }
}

impl ParamSource {
  pub fn get(
    &self,
    param_buffers: &[[f32; FRAME_SIZE]],
    adsrs: &[Adsr],
    sample_ix_within_frame: usize,
    base_frequency: f32,
  ) -> f32 {
    match self {
      ParamSource::ParamBuffer(buf_ix) => {
        let raw = if cfg!(debug_assertions) {
          param_buffers[*buf_ix][sample_ix_within_frame]
        } else {
          unsafe {
            *param_buffers
              .get_unchecked(*buf_ix)
              .get_unchecked(sample_ix_within_frame)
          }
        };

        raw
      },
      ParamSource::Constant { last_val, cur_val } => {
        let mut state = last_val.get();
        dsp::smooth(&mut state, *cur_val, 0.99);
        let out = state;
        last_val.set(out);
        out
      },
      ParamSource::PerVoiceADSR(AdsrState {
        adsr_ix,
        scale,
        shift,
      }) => {
        let adsr = if cfg!(debug_assertions) {
          &adsrs[*adsr_ix]
        } else {
          unsafe { adsrs.get_unchecked(*adsr_ix) }
        };

        (unsafe {
          *adsr
            .get_cur_frame_output()
            .get_unchecked(sample_ix_within_frame)
        }) * scale
          + shift
      },
      ParamSource::BaseFrequencyMultiplier {
        multiplier,
        offset_hz,
      } => base_frequency * *multiplier + offset_hz,
      ParamSource::MIDIControlValue {
        control_index,
        scale,
        shift,
      } => unsafe { MIDI_CONTROL_VALUES[*control_index] * *scale + *shift },
      ParamSource::BeatsToSamples(beats) => {
        let cur_bpm = crate::get_cur_bpm();
        let cur_bps = cur_bpm / 60.;
        let seconds_per_beat = 1. / cur_bps;
        let samples_per_beat = seconds_per_beat * SAMPLE_RATE as f32;
        samples_per_beat * *beats
      },
      ParamSource::Random {
        last_val,
        target_val,
        samples_since_last_update,
        min,
        max,
        update_interval_samples,
        smoothing_coefficient,
      } => {
        let cur_value = if samples_since_last_update.get() >= *update_interval_samples {
          samples_since_last_update.set(0);
          let new_target_val = common::rng().gen_range(*min, *max);
          target_val.set(new_target_val);
          new_target_val
        } else {
          samples_since_last_update.set(samples_since_last_update.get() + 1);
          target_val.get()
        };

        if *smoothing_coefficient == 0. || *smoothing_coefficient == 1. {
          last_val.set(cur_value);
          return cur_value;
        }
        let mut state = last_val.get();
        dsp::smooth(&mut state, cur_value, *smoothing_coefficient);
        last_val.set(state);
        state
      },
    }
  }

  pub fn from_parts(
    value_type: usize,
    value_param_int: usize,
    value_param_float: f32,
    value_param_float_2: f32,
    value_param_float_3: f32,
  ) -> Self {
    match value_type {
      0 => ParamSource::ParamBuffer(value_param_int),
      1 => ParamSource::Constant {
        last_val: Cell::new(value_param_float),
        cur_val: value_param_float,
      },
      2 => ParamSource::PerVoiceADSR(AdsrState {
        adsr_ix: value_param_int,
        scale: value_param_float,
        shift: value_param_float_2,
      }),
      3 => ParamSource::BaseFrequencyMultiplier {
        multiplier: value_param_float,
        offset_hz: value_param_float_2,
      },
      4 => ParamSource::MIDIControlValue {
        control_index: value_param_int,
        scale: value_param_float,
        shift: value_param_float_2,
      },
      5 => ParamSource::BeatsToSamples(value_param_float),
      6 => {
        let (min, max) = (value_param_float, value_param_float_2);
        let init = common::rng().gen_range(min, max);
        ParamSource::Random {
          last_val: Cell::new(init),
          target_val: Cell::new(init),
          samples_since_last_update: Cell::new(0),
          min,
          max,
          update_interval_samples: value_param_int,
          smoothing_coefficient: value_param_float_3,
        }
      },
      _ => panic!("Invalid value type; expected [0,4]"),
    }
  }

  #[cfg(feature = "simd")]
  pub fn render_raw<'a>(
    &self,
    RenderRawParams {
      param_buffers,
      adsrs,
      base_frequencies,
    }: &'a RenderRawParams<'a>,
    output_buf: &mut [f32; FRAME_SIZE],
  ) {
    match self {
      ParamSource::Constant { last_val, cur_val } => unsafe {
        let diff = (*cur_val - last_val.get()).abs();
        if diff < 0.000001 {
          let splat = f32x4_splat(*cur_val);
          let base_output_ptr = output_buf.as_ptr() as *mut v128;
          for i in 0..FRAME_SIZE / 4 {
            v128_store(base_output_ptr.add(i), splat);
          }
        } else {
          let mut state = last_val.get();
          for i in 0..FRAME_SIZE {
            output_buf[i] = dsp::smooth(&mut state, *cur_val, 0.97);
          }
          last_val.set(state);
        }
      },
      ParamSource::ParamBuffer(buffer_ix) => {
        let param_buf = unsafe { param_buffers.get_unchecked(*buffer_ix) };
        let base_input_ptr = param_buf.as_ptr() as *const v128;
        let base_output_ptr = output_buf.as_ptr() as *mut v128;
        for i in 0..FRAME_SIZE / 4 {
          unsafe {
            let v = v128_load(base_input_ptr.add(i));
            v128_store(base_output_ptr.add(i), v);
          }
        }
      },
      ParamSource::BaseFrequencyMultiplier {
        multiplier,
        offset_hz,
      } => {
        let base_input_ptr = base_frequencies.as_ptr() as *const v128;
        let base_output_ptr = output_buf.as_ptr() as *mut v128;
        let multiplier = f32x4_splat(*multiplier);
        let offset = f32x4_splat(*offset_hz);

        for i in 0..FRAME_SIZE / 4 {
          unsafe {
            let v = v128_load(base_input_ptr.add(i));
            let multiplied = f32x4_mul(v, multiplier);
            let added = f32x4_add(multiplied, offset);
            v128_store(base_output_ptr.add(i), added);
          }
        }
      },
      ParamSource::PerVoiceADSR(AdsrState {
        adsr_ix,
        scale,
        shift,
      }) => {
        let scale = f32x4_splat(*scale);
        let shift = f32x4_splat(*shift);

        let adsr = unsafe { adsrs.get_unchecked(*adsr_ix) };
        let base_output_ptr = output_buf.as_ptr() as *mut v128;
        let adsr_buf_ptr = adsr.get_cur_frame_output().as_ptr() as *const v128;

        for i in 0..FRAME_SIZE / 4 {
          unsafe {
            let v = v128_load(adsr_buf_ptr.add(i));
            let scaled = f32x4_mul(v, scale);
            let scaled_and_shifted = f32x4_add(scaled, shift);
            v128_store(base_output_ptr.add(i), scaled_and_shifted);
          }
        }
      },
      ParamSource::MIDIControlValue {
        control_index,
        scale,
        shift,
      } => {
        let value = unsafe {
          f32x4_splat(*MIDI_CONTROL_VALUES.get_unchecked(*control_index) * scale + shift)
        };

        let base_output_ptr = output_buf.as_ptr() as *mut v128;
        for i in 0..FRAME_SIZE / 4 {
          unsafe {
            v128_store(base_output_ptr.add(i), value);
          }
        }
      },
      ParamSource::BeatsToSamples(beats) => {
        let cur_bpm = crate::get_cur_bpm();
        let cur_bps = cur_bpm / 60.;
        let seconds_per_beat = 1. / cur_bps;
        let samples_per_beat = seconds_per_beat * SAMPLE_RATE as f32;
        let samples = samples_per_beat * *beats;

        let splat = f32x4_splat(samples);
        let base_output_ptr = output_buf.as_ptr() as *mut v128;
        for i in 0..FRAME_SIZE / 4 {
          unsafe { v128_store(base_output_ptr.add(i), splat) };
        }
      },
      ParamSource::Random {
        last_val,
        target_val,
        samples_since_last_update,
        min,
        max,
        update_interval_samples,
        smoothing_coefficient,
      } => {
        let (min, max, update_interval_samples, smoothing_coefficient) =
          (*min, *max, *update_interval_samples, *smoothing_coefficient);
        let mut state = last_val.get();
        let mut samples_since_last_update_local = samples_since_last_update.get();
        for i in 0..FRAME_SIZE {
          let new_val = if samples_since_last_update_local >= update_interval_samples {
            samples_since_last_update_local = 1;
            let new_target_val = common::rng().gen_range(min, max);
            target_val.set(new_target_val);
            new_target_val
          } else {
            samples_since_last_update_local += 1;
            target_val.get()
          };

          if smoothing_coefficient != 0. && smoothing_coefficient != 1. {
            output_buf[i] = dsp::smooth(&mut state, new_val, smoothing_coefficient);
          } else {
            output_buf[i] = new_val;
            state = new_val;
          }
        }
        last_val.set(state);
        samples_since_last_update.set(samples_since_last_update_local);
      },
    }
  }

  #[cfg(not(feature = "simd"))]
  pub fn render_raw<'a>(
    &self,
    RenderRawParams {
      param_buffers,
      adsrs,
      base_frequencies,
    }: &'a RenderRawParams<'a>,
    output_buf: &mut [f32; FRAME_SIZE],
  ) {
    match self {
      ParamSource::Constant { last_val, cur_val } => {
        let diff = (*cur_val - last_val.get()).abs();
        if diff < 0.000001 {
          for i in 0..FRAME_SIZE {
            unsafe {
              *output_buf.get_unchecked_mut(i) = *cur_val;
            };
          }
        } else {
          let mut state = last_val.get();
          for i in 0..FRAME_SIZE {
            output_buf[i] = dsp::smooth(&mut state, *cur_val, 0.97);
          }
          last_val.set(state);
        }
      },
      ParamSource::ParamBuffer(buffer_ix) => {
        output_buf.clone_from_slice(unsafe { param_buffers.get_unchecked(*buffer_ix) });
      },
      ParamSource::BaseFrequencyMultiplier {
        multiplier,
        offset_hz,
      } =>
        for i in 0..FRAME_SIZE {
          unsafe {
            *output_buf.get_unchecked_mut(i) =
              (*base_frequencies.get_unchecked(i)) * *multiplier + *offset_hz;
          };
        },
      ParamSource::PerVoiceADSR(AdsrState {
        adsr_ix,
        scale,
        shift,
      }) => {
        let adsr = unsafe { adsrs.get_unchecked(*adsr_ix) };
        let adsr_buf = adsr.get_cur_frame_output();

        for i in 0..FRAME_SIZE {
          unsafe {
            *output_buf.get_unchecked_mut(i) = (*adsr_buf.get_unchecked(i)) * (*scale) + (*shift);
          }
        }
      },
      ParamSource::MIDIControlValue {
        control_index,
        scale,
        shift,
      } => {
        let value = unsafe { MIDI_CONTROL_VALUES[*control_index] * *scale + *shift };

        for i in 0..FRAME_SIZE {
          unsafe {
            *output_buf.get_unchecked_mut(i) = value;
          }
        }
      },
      ParamSource::BeatsToSamples(beats) => {
        let cur_bpm = crate::get_cur_bpm();
        let cur_bps = cur_bpm / 60.;
        let seconds_per_beat = 1. / cur_bps;
        let samples_per_beat = seconds_per_beat * SAMPLE_RATE as f32;
        let samples = samples_per_beat * *beats;

        for i in 0..FRAME_SIZE {
          unsafe {
            *output_buf.get_unchecked_mut(i) = samples;
          };
        }
      },
      ParamSource::Random {
        last_val,
        target_val,
        samples_since_last_update,
        min,
        max,
        update_interval_samples,
        smoothing_coefficient,
      } => {
        let (min, max, update_interval_samples, smoothing_coefficient) =
          (*min, *max, *update_interval_samples, *smoothing_coefficient);
        let mut state = last_val.get();
        let mut samples_since_last_update_local = samples_since_last_update.get();
        for i in 0..FRAME_SIZE {
          let new_val = if samples_since_last_update_local >= update_interval_samples {
            samples_since_last_update_local = 1;
            let new_target_val = common::rng().gen_range(min, max);
            target_val.set(new_target_val);
            new_target_val
          } else {
            samples_since_last_update_local += 1;
            target_val.get()
          };

          if smoothing_coefficient != 0. && smoothing_coefficient != 1. {
            output_buf[i] = dsp::smooth(&mut state, new_val, smoothing_coefficient);
          } else {
            output_buf[i] = new_val;
            state = new_val;
          }
        }
        last_val.set(state);
        samples_since_last_update.set(samples_since_last_update_local);
      },
    }
  }
}
