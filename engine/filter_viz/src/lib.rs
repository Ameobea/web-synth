//! Computes frequency responses for the synth designer's output filter for visualization.
//!
//! Mirrors the filter-type -> filter-chain mapping used by the FM synth's `FilterModule` (see
//! `wavetable::fm::filter`) and reuses the `dsp` crate's response functions so the plotted curve
//! matches the real filter exactly, including the dB/linear Q conventions handled inside
//! `BiquadFilter::compute_coefficients`.

use dsp::{
  filters::{
    biquad::{compute_higher_order_biquad_q_factors, BiquadFilter, FilterMode},
    dynabandpass::DynabandpassFilter,
  },
  linear_to_db_checked, SAMPLE_RATE,
};

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
  fn log_err(ptr: *const u8, len: usize);
}

const START_FREQ: f32 = 10.;

static mut DID_INIT: bool = false;

fn maybe_init() {
  unsafe {
    if DID_INIT {
      return;
    }
    DID_INIT = true;
  }

  #[cfg(target_arch = "wasm32")]
  common::set_raw_panic_hook(log_err);
}

#[derive(Default)]
pub struct FilterVizCtx {
  mags_db: Vec<f32>,
}

#[no_mangle]
pub extern "C" fn filter_viz_init() -> *mut FilterVizCtx {
  maybe_init();
  Box::into_raw(Box::new(FilterVizCtx::default()))
}

#[inline]
fn single_response(mode: FilterMode, q: f32, cutoff: f32, gain: f32, grid: usize) -> Vec<f32> {
  BiquadFilter::<f32>::compute_response_grid::<f32>(
    mode,
    q,
    cutoff,
    gain,
    START_FREQ,
    SAMPLE_RATE,
    grid,
  )
  .1
}

/// Cascade of `order / 2` biquads with the same Butterworth-style base Q factors used by the audio
/// path.  The manual Q is added only to the last stage, matching
/// `apply_filter_chain_and_compute_coefficients`.
fn order_chain_response(
  mode: FilterMode,
  order: usize,
  q: f32,
  cutoff: f32,
  gain: f32,
  grid: usize,
) -> Vec<f32> {
  let base_qs = compute_higher_order_biquad_q_factors(order);
  let last = base_qs.len() - 1;
  let mut acc: Vec<f32> = Vec::new();
  for (i, &base_q) in base_qs.iter().enumerate() {
    let stage_q = if i == last { base_q + q } else { base_q };
    let mags = single_response(mode, stage_q, cutoff, gain, grid);
    if i == 0 {
      acc = mags;
    } else {
      for j in 0..grid {
        acc[j] *= mags[j];
      }
    }
  }
  acc
}

#[inline]
fn dyna_response(cutoff: f32, bandwidth: f32, grid: usize) -> Vec<f32> {
  DynabandpassFilter::compute_response_grid::<f32>(cutoff, bandwidth, START_FREQ, SAMPLE_RATE, grid)
    .1
}

fn compute_linear_mags(
  filter_type: usize,
  q: f32,
  cutoff: f32,
  gain: f32,
  grid: usize,
) -> Vec<f32> {
  use FilterMode::*;
  match filter_type {
    0 => single_response(Lowpass, q, cutoff, gain, grid),
    1 => order_chain_response(Lowpass, 4, q, cutoff, gain, grid),
    2 => order_chain_response(Lowpass, 8, q, cutoff, gain, grid),
    3 => order_chain_response(Lowpass, 16, q, cutoff, gain, grid),
    4 => single_response(Highpass, q, cutoff, gain, grid),
    5 => order_chain_response(Highpass, 4, q, cutoff, gain, grid),
    6 => order_chain_response(Highpass, 8, q, cutoff, gain, grid),
    7 => order_chain_response(Highpass, 16, q, cutoff, gain, grid),
    8 => single_response(Bandpass, q, cutoff, gain, grid),
    9 => order_chain_response(Bandpass, 4, q, cutoff, gain, grid),
    10 => order_chain_response(Bandpass, 8, q, cutoff, gain, grid),
    11 => order_chain_response(Bandpass, 16, q, cutoff, gain, grid),
    12 => dyna_response(cutoff, 50., grid),
    13 => dyna_response(cutoff, 100., grid),
    14 => dyna_response(cutoff, 200., grid),
    15 => dyna_response(cutoff, 400., grid),
    16 => dyna_response(cutoff, 800., grid),
    17 => single_response(Lowshelf, q, cutoff, gain, grid),
    18 => single_response(Highshelf, q, cutoff, gain, grid),
    19 => single_response(Peak, q, cutoff, gain, grid),
    20 => single_response(Notch, q, cutoff, gain, grid),
    21 => single_response(Allpass, q, cutoff, gain, grid),
    _ => single_response(Lowpass, q, cutoff, gain, grid),
  }
}

#[no_mangle]
pub extern "C" fn filter_viz_compute(
  ctx: *mut FilterVizCtx,
  filter_type: usize,
  q: f32,
  cutoff: f32,
  gain: f32,
  grid_size: usize,
) {
  let ctx = unsafe { &mut *ctx };
  if grid_size == 0 {
    ctx.mags_db.clear();
    return;
  }

  let mut mags = compute_linear_mags(filter_type, q, cutoff, gain, grid_size);
  for mag in &mut mags {
    *mag = linear_to_db_checked(*mag);
  }
  ctx.mags_db = mags;
}

#[no_mangle]
pub extern "C" fn filter_viz_get_mags_ptr(ctx: *const FilterVizCtx) -> *const f32 {
  let ctx = unsafe { &*ctx };
  ctx.mags_db.as_ptr()
}
