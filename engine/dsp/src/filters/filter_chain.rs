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
  for i in 0..frame.len() {
    let mut val = frame[i];
    for (filter_ix, filter) in chain.into_iter().enumerate() {
      let coeffs = BiquadFilter::compute_coefficients(
        filter_mode,
        precomputed_base_qs[filter_ix] + q[i],
        0.,
        cutoff_freq[i],
        gain[i],
      );
      val = filter.apply_with_coefficients(val, coeffs.0, coeffs.1, coeffs.2, coeffs.3, coeffs.4);
    }
    frame[i] = val;
  }
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
    for i in 0..frame.len() {
      let coeffs = BiquadFilter::compute_coefficients(
        filter_mode,
        precomputed_base_qs[filter_ix],
        0.,
        cutoff_freq[i],
        0.,
      );

      let mut val = frame[i];
      val = filter.apply_with_coefficients(val, coeffs.0, coeffs.1, coeffs.2, coeffs.3, coeffs.4);
      frame[i] = val;
    }
  }
}
