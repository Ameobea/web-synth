use common::ref_static_mut;
use dsp::FRAME_SIZE;

#[repr(u8)]
pub enum QuantizationMode {
  Round = 0,
  Floor = 1,
  Ceil = 2,
  Trunc = 3,
}

pub struct QuantizerState {
  pub quantization_interval: f32,
  pub mode: QuantizationMode,
}

impl QuantizerState {
  #[inline(always)]
  pub fn quantize(&self, sample: f32) -> f32 {
    let diff = sample % self.quantization_interval;

    match self.mode {
      QuantizationMode::Round => {
        let abs_sample = sample.abs();
        let abs_diff = abs_sample % self.quantization_interval;

        let up = abs_diff > (self.quantization_interval / 2.);

        if up {
          abs_sample + (self.quantization_interval - abs_diff)
        } else {
          abs_sample - abs_diff
        }
        .copysign(sample)
      },
      QuantizationMode::Floor =>
        if sample >= 0. {
          sample - diff
        } else {
          sample - self.quantization_interval - diff
        },
      QuantizationMode::Ceil =>
        if sample >= 0. {
          sample + (self.quantization_interval - diff)
        } else {
          sample - diff
        },
      QuantizationMode::Trunc => sample - diff,
    }
  }
}

static mut STATE: QuantizerState = QuantizerState {
  quantization_interval: 1.,
  mode: QuantizationMode::Round,
};
fn state() -> &'static mut QuantizerState { ref_static_mut!(STATE) }

#[no_mangle]
pub extern "C" fn set_quantization_state(quantization_interval: f32, mode: u8) {
  let state = state();
  state.quantization_interval = quantization_interval;
  state.mode = unsafe { std::mem::transmute(mode) };
}

static mut IO_BUFFER: [f32; FRAME_SIZE] = [0.; FRAME_SIZE];
fn io_buf() -> &'static mut [f32; FRAME_SIZE] { ref_static_mut!(IO_BUFFER) }

#[no_mangle]
pub extern "C" fn get_io_buf_ptr() -> *mut f32 { io_buf().as_mut_ptr() }

#[no_mangle]
pub extern "C" fn process() {
  let state = state();
  if state.quantization_interval <= 0. {
    return;
  }

  for sample in io_buf() {
    *sample = state.quantize(*sample)
  }
}

#[test]
fn test_round_quantization() {
  let state = QuantizerState {
    quantization_interval: 0.25,
    mode: QuantizationMode::Round,
  };

  assert_eq!(state.quantize(1.49), 1.5);
  assert_eq!(state.quantize(1.26), 1.25);
  assert_eq!(state.quantize(-1.26), -1.25);
  assert_eq!(state.quantize(-1.49), -1.5);
  assert_eq!(state.quantize(0.02), 0.);
  assert_eq!(state.quantize(-0.02), 0.);
}

#[test]
fn test_floor_quantization() {
  let state = QuantizerState {
    quantization_interval: 0.25,
    mode: QuantizationMode::Floor,
  };

  assert_eq!(state.quantize(1.49), 1.25);
  assert_eq!(state.quantize(1.26), 1.25);
  assert_eq!(state.quantize(-1.26), -1.5);
  assert_eq!(state.quantize(-1.49), -1.5);
  assert_eq!(state.quantize(0.02), 0.);
  assert_eq!(state.quantize(-0.02), -0.25);
}

#[test]
fn test_ceil_quantization() {
  let state = QuantizerState {
    quantization_interval: 0.25,
    mode: QuantizationMode::Ceil,
  };

  assert_eq!(state.quantize(1.49), 1.5);
  assert_eq!(state.quantize(1.26), 1.5);
  assert_eq!(state.quantize(-1.26), -1.25);
  assert_eq!(state.quantize(-1.49), -1.25);
  assert_eq!(state.quantize(0.02), 0.25);
  assert_eq!(state.quantize(-0.02), 0.);
}

#[test]
fn test_trunc_quantization() {
  let state = QuantizerState {
    quantization_interval: 0.25,
    mode: QuantizationMode::Trunc,
  };

  assert_eq!(state.quantize(1.49), 1.25);
  assert_eq!(state.quantize(1.26), 1.25);
  assert_eq!(state.quantize(-1.26), -1.25);
  assert_eq!(state.quantize(-1.49), -1.25);
  assert_eq!(state.quantize(0.02), 0.);
  assert_eq!(state.quantize(-0.02), 0.);
}
