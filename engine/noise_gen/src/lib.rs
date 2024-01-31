use common::{ref_static_mut, rng};
use rand::prelude::*;

#[derive(Clone, Copy)]
enum NoiseType {
  White,
  Pink,
  Brown,
  SteppedRandom { update_freq_samples: u32 },
}

static mut NOISE_TYPE: NoiseType = NoiseType::White;
pub static mut OUTPUT: [f32; 128] = [0.; 128];
static mut GAIN: f32 = 1.;
static mut SMOOTHING_COEFFICIENT: f32 = 0.;
static mut QUANTIZATION_FACTOR: usize = 0;

#[no_mangle]
pub unsafe extern "C" fn set_noise_type(noise_type: u32, update_freq_samples: u32) {
  NOISE_TYPE = match noise_type {
    0 => NoiseType::White,
    1 => NoiseType::Pink,
    2 => NoiseType::Brown,
    3 => NoiseType::SteppedRandom {
      update_freq_samples,
    },
    _ => panic!("Invalid noise type: {}", noise_type),
  }
}

#[no_mangle]
pub unsafe extern "C" fn set_gain(gain: f32) { GAIN = gain; }

#[no_mangle]
pub unsafe extern "C" fn set_smoothing_coefficient(smoothing_cofficient: f32) {
  SMOOTHING_COEFFICIENT = smoothing_cofficient;
}

#[no_mangle]
pub unsafe extern "C" fn set_quantization_factor(quantize_factor: usize) {
  QUANTIZATION_FACTOR = quantize_factor;
}

fn gen_white_noise() -> f32 { rng().gen_range(-1., 1.) }

struct SteppedRandomState {
  pub update_freq_samples: u32,
  pub samples_since_last_update: u32,
  pub val: f32,
}

impl SteppedRandomState {
  pub const fn new() -> Self {
    SteppedRandomState {
      update_freq_samples: 10_000,
      samples_since_last_update: 0,
      val: 0.,
    }
  }
}

static mut STEPPED_RANDOM_STATE: SteppedRandomState = SteppedRandomState::new();

fn gen_stepped_random() -> f32 {
  unsafe {
    if STEPPED_RANDOM_STATE.samples_since_last_update >= STEPPED_RANDOM_STATE.update_freq_samples {
      STEPPED_RANDOM_STATE.val = rng().gen_range(-1., 1.);
      STEPPED_RANDOM_STATE.samples_since_last_update = 0;
    } else {
      STEPPED_RANDOM_STATE.samples_since_last_update += 1;
    }
    STEPPED_RANDOM_STATE.val
  }
}

static mut LAST_VAL: f32 = 0.;
#[no_mangle]
pub unsafe extern "C" fn generate() -> *const f32 {
  let generator = match NOISE_TYPE {
    NoiseType::White => gen_white_noise,
    NoiseType::SteppedRandom {
      update_freq_samples,
    } => {
      STEPPED_RANDOM_STATE.update_freq_samples = update_freq_samples;
      gen_stepped_random
    },
    NoiseType::Pink => todo!(),
    NoiseType::Brown => todo!(),
  };
  for out in ref_static_mut!(OUTPUT) {
    let sample = generator() * GAIN;

    if QUANTIZATION_FACTOR > 0 {
      LAST_VAL = dsp::quantize(-1., 1., QUANTIZATION_FACTOR as f32, sample);
    } else {
      if SMOOTHING_COEFFICIENT != 0. {
        dsp::one_pole(
          ref_static_mut!(LAST_VAL),
          sample,
          1. - SMOOTHING_COEFFICIENT,
        );
      } else {
        LAST_VAL = sample;
      }
    }
    *out = LAST_VAL;
  }

  OUTPUT.as_ptr()
}
