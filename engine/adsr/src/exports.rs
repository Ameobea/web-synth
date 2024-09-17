use std::rc::Rc;

use crate::{managed_adsr::ManagedAdsr, Adsr, AdsrStep, RampFn, RENDERED_BUFFER_SIZE};

extern "C" {
  fn log_err(msg: *const u8, len: usize);
}

pub struct AdsrContext {
  pub adsrs: Vec<ManagedAdsr>,
  pub most_recent_gated_ix: usize,
}

impl AdsrContext {
  pub fn new(adsrs: Vec<ManagedAdsr>) -> Self {
    AdsrContext {
      adsrs,
      most_recent_gated_ix: 0,
    }
  }
}

fn round_tiny_to_zero(val: f32) -> f32 {
  if val.abs() < 0.001 {
    0.
  } else {
    val
  }
}

fn decode_steps(encoded_steps: &[f32]) -> Vec<AdsrStep> {
  assert_eq!(
    encoded_steps.len() % 4,
    0,
    "`encoded_steps` length must be divisible by 4"
  );
  encoded_steps
    .chunks_exact(4)
    .map(|vals| match vals {
      &[x, y, ramp_fn_type, ramp_fn_param] => {
        let ramper = match ramp_fn_type {
          x if x == 0. => RampFn::Instant,
          x if x == 1. => RampFn::Linear,
          x if x == 2. => RampFn::Exponential {
            exponent: ramp_fn_param,
          },
          _ => unreachable!("Invalid ramp fn type val"),
        };
        AdsrStep {
          x: round_tiny_to_zero(x),
          y: round_tiny_to_zero(y),
          ramper,
        }
      },
      _ => unreachable!(),
    })
    .collect()
}

static mut ENCODED_ADSR_STEP_BUF: Vec<f32> = Vec::new();

/// Resizes the step buffer to hold at least `step_count` steps (`step_count * 4` f32s)
#[no_mangle]
pub unsafe extern "C" fn get_encoded_adsr_step_buf_ptr(step_count: usize) -> *mut f32 {
  let needed_capacity = step_count * 4;
  if ENCODED_ADSR_STEP_BUF.capacity() < needed_capacity {
    let additional = needed_capacity - ENCODED_ADSR_STEP_BUF.capacity();
    ENCODED_ADSR_STEP_BUF.reserve(additional);
  }
  ENCODED_ADSR_STEP_BUF.set_len(needed_capacity);
  ENCODED_ADSR_STEP_BUF.as_mut_ptr()
}

#[derive(Clone, Copy)]
#[repr(u32)]
pub enum AdsrLengthMode {
  Ms = 0,
  Beats = 1,
}

impl AdsrLengthMode {
  pub fn from_u32(val: u32) -> Self {
    match val {
      0 => AdsrLengthMode::Ms,
      1 => AdsrLengthMode::Beats,
      _ => unreachable!("Invalid AdsrLengthMode value"),
    }
  }
}

static mut DID_INIT: bool = false;

/// `encoded_steps` should be an array of imaginary tuples like `(x, y, ramp_fn_type,
/// ramp_fn_param)`
#[no_mangle]
pub unsafe extern "C" fn create_adsr_ctx(
  loop_point: f32,
  length: f32,
  length_mode: u32,
  release_start_phase: f32,
  adsr_count: usize,
  log_scale: bool,
  early_release_mode_type: usize,
  early_release_mode_param: usize,
) -> *mut AdsrContext {
  let needs_init = unsafe {
    if !DID_INIT {
      DID_INIT = true;
      true
    } else {
      false
    }
  };
  if needs_init {
    let hook = move |info: &std::panic::PanicHookInfo| {
      let msg = format!("PANIC: {}", info.to_string());
      let bytes = msg.into_bytes();
      let len = bytes.len();
      let ptr = bytes.as_ptr();
      unsafe { log_err(ptr, len) }
    };

    std::panic::set_hook(Box::new(hook))
  }

  let length_mode = AdsrLengthMode::from_u32(length_mode);

  let rendered: Rc<[f32; RENDERED_BUFFER_SIZE]> = Rc::new([0.0f32; RENDERED_BUFFER_SIZE]);
  let decoded_steps = decode_steps(ENCODED_ADSR_STEP_BUF.as_slice());
  assert!(adsr_count > 0);

  let mut adsrs = Vec::with_capacity(adsr_count);
  for _ in 0..adsr_count {
    let adsr = Adsr::new(
      decoded_steps.clone(),
      if loop_point < 0. {
        None
      } else {
        Some(loop_point)
      },
      10_000., // will be updated during render
      match length_mode {
        AdsrLengthMode::Ms => None,
        AdsrLengthMode::Beats => Some(length),
      },
      release_start_phase,
      Rc::clone(&rendered),
      crate::EarlyReleaseConfig::from_parts(early_release_mode_type, early_release_mode_param),
      log_scale,
    );
    adsrs.push(ManagedAdsr {
      adsr,
      length_mode,
      length,
    });
  }
  adsrs[0].render();

  Box::into_raw(Box::new(AdsrContext::new(adsrs)))
}

// #[no_mangle]
// pub unsafe extern "C" fn free_adsr_ctx(ctx: *mut AdsrContext) { drop(Box::from_raw(ctx)) }

#[no_mangle]
pub unsafe extern "C" fn update_adsr_steps(ctx: *mut AdsrContext) {
  let decoded_steps = decode_steps(ENCODED_ADSR_STEP_BUF.as_slice());
  for adsr in &mut (*ctx).adsrs {
    adsr.adsr.set_steps(decoded_steps.clone());
  }
  (*ctx).adsrs[0].render();
}

#[no_mangle]
pub unsafe extern "C" fn update_adsr_len_ms(
  ctx: *mut AdsrContext,
  new_length: f32,
  new_raw_length_mode: u32,
) {
  let new_length_mode = AdsrLengthMode::from_u32(new_raw_length_mode);
  for adsr in &mut (*ctx).adsrs {
    adsr.set_length(new_length_mode, new_length);
  }
}

#[no_mangle]
pub unsafe extern "C" fn gate_adsr(ctx: *mut AdsrContext, index: usize, cur_beat: f32) {
  (*ctx).adsrs[index].adsr.gate(cur_beat);
  (*ctx).most_recent_gated_ix = index;
}

#[no_mangle]
pub unsafe extern "C" fn ungate_adsr(ctx: *mut AdsrContext, index: usize) {
  (*ctx).adsrs[index].adsr.ungate()
}

/// Updates all ADSRs, rendering them to their respective output buffers.  Returns the current phase
/// of the most recent gated ADSR.
#[no_mangle]
pub unsafe extern "C" fn process_adsr(
  ctx: *mut AdsrContext,
  output_range_min: f32,
  output_range_max: f32,
  cur_bpm: f32,
  cur_beat: f32,
) -> f32 {
  let shift = output_range_min;
  let scale = output_range_max - output_range_min;
  for adsr in &mut (*ctx).adsrs {
    adsr.render_frame(scale, shift, cur_bpm, cur_beat);
  }

  (*ctx).adsrs[(*ctx).most_recent_gated_ix].adsr.phase
}

#[no_mangle]
pub unsafe extern "C" fn adsr_set_loop_point(ctx: *mut AdsrContext, new_loop_point: f32) {
  for adsr in &mut (*ctx).adsrs {
    adsr.adsr.set_loop_point(if new_loop_point < 0. {
      None
    } else {
      Some(new_loop_point)
    });
  }
}

#[no_mangle]
pub unsafe extern "C" fn adsr_set_release_start_phase(
  ctx: *mut AdsrContext,
  new_release_start_phase: f32,
) {
  for adsr in &mut (*ctx).adsrs {
    adsr.adsr.set_release_start_phase(new_release_start_phase);
  }
}

#[no_mangle]
pub unsafe extern "C" fn adsr_set_log_scale(ctx: *mut AdsrContext, log_scale: bool) {
  for adsr in &mut (*ctx).adsrs {
    adsr.adsr.log_scale = log_scale;
  }
}

#[no_mangle]
pub unsafe extern "C" fn adsr_get_output_buf_ptr(
  ctx: *const AdsrContext,
  index: usize,
) -> *const f32 {
  (*ctx).adsrs[index].adsr.get_cur_frame_output().as_ptr()
}

/// If the ADSR is in the "Done" state, meaning it will output a constant value forever until gated
/// again, this function will set the constant value to the given value.
///
/// Useful for situations where you're editing the ADSR interactively and want to see the effect of
/// the change immediately.
///
/// Expects a normalized value in the range [0, 1].
#[no_mangle]
pub unsafe extern "C" fn adsr_set_frozen_output_value(
  ctx: *mut AdsrContext,
  new_frozen_output_value: f32,
  output_range_min: f32,
  output_range_max: f32,
) {
  let scale = output_range_max - output_range_min;
  let shift = output_range_min;
  for adsr in &mut (*ctx).adsrs {
    adsr
      .adsr
      .set_frozen_output_value(new_frozen_output_value, scale, shift);
  }
}

#[no_mangle]
pub unsafe extern "C" fn adsr_set_frozen_output_value_from_phase(
  ctx: *mut AdsrContext,
  new_frozen_output_phase: f32,
  output_range_min: f32,
  output_range_max: f32,
) {
  let scale = output_range_max - output_range_min;
  let shift = output_range_min;
  for adsr in &mut (*ctx).adsrs {
    adsr
      .adsr
      .set_frozen_output_value_from_phase(new_frozen_output_phase, scale, shift);
  }
}
