use crate::FRAME_SIZE;

use super::biquad::{BiquadFilter, FilterMode};

#[inline]
pub fn apply_filter_chain_full<const N: usize>(
  chain: &mut [BiquadFilter; N],
  input_buf: [f32; FRAME_SIZE],
  output_buf: &mut [f32; FRAME_SIZE],
) {
  let mut filtered = input_buf;
  for filter in chain.iter_mut() {
    for i in 0..FRAME_SIZE {
      filtered[i] = filter.apply(filtered[i]);
    }
  }

  for i in 0..FRAME_SIZE {
    output_buf[i] = filtered[i];
  }
}

#[inline]
pub fn apply_filter_chain_and_compute_coefficients<const N: usize>(
  chain: &mut [BiquadFilter; N],
  frame: &mut [f32; FRAME_SIZE],
  filter_mode: FilterMode,
  precomputed_base_qs: &[f32; N],
  q: &[f32; FRAME_SIZE],
  cutoff_freq: &[f32; FRAME_SIZE],
  gain: &[f32; FRAME_SIZE],
) {
  for filter_ix in 0..N - 1 {
    let filter = &mut chain[filter_ix];
    let q_val = precomputed_base_qs[filter_ix];
    filter.compute_coefficients_and_apply_frame_static_q(
      filter_mode,
      q_val,
      cutoff_freq,
      gain,
      frame,
    );
  }

  let filter_ix = N - 1;
  let filter = &mut chain[filter_ix];
  // Manual Q is only applied to the last filter in the chain
  let base_q = precomputed_base_qs[filter_ix];
  filter.compute_coefficients_and_apply_frame(filter_mode, base_q, q, cutoff_freq, gain, frame);
}

#[inline]
pub fn apply_filter_chain_and_compute_coefficients_minimal<const N: usize>(
  chain: &mut [BiquadFilter; N],
  frame: &mut [f32; FRAME_SIZE],
  filter_mode: FilterMode,
  precomputed_base_qs: &[f32; N],
  cutoff_freq: &[f32; FRAME_SIZE],
) {
  for (filter_ix, filter) in chain.into_iter().enumerate() {
    filter.compute_coefficients_and_apply_frame_minimal(
      filter_mode,
      cutoff_freq,
      precomputed_base_qs[filter_ix],
      frame,
    );
  }
}
