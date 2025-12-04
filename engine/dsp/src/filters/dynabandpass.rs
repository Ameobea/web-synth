use crate::{
  clamp,
  filters::{
    biquad::{BiquadFilter, FilterMode},
    filter_chain::apply_filter_chain_and_compute_coefficients_minimal,
  },
  FRAME_SIZE, NYQUIST,
};
use num_traits::{Float, FloatConst};
use std::ops::{AddAssign, MulAssign};

/// Frequency is a log scale, so we need to increase the bandwidth as the base frequency increases.
///
/// Given the frequency of the center of a band and its width when the band's center is 10 Hz,
/// this function returns the width of the band at `frequency`.
#[inline]
fn compute_modified_dynabandpass_filter_bandwidth(
  base_frequency: f32,
  base_bandwidth: f32,
  frequency: f32,
) -> f32 {
  let log_base_frequency = (base_frequency + base_bandwidth / 2.).log10();
  let log_frequency = frequency.log10();
  let log_base_bandwidth = base_bandwidth.log10();

  10f32.powf(log_base_bandwidth + (log_frequency - log_base_frequency))
}

/// Computes the cutoff frequencies for the high-order lowpass and highpass filters that make up the
/// dynabandpass filter.
///
/// TODO: it would be good to get this so that the handle appears in the middle of the band on a log
/// scale.  I tried it, but it resulted in the actual band width becoming (or appearing to become)
/// significantly smaller.  Could be visual but I don't think so
#[inline]
fn compute_filter_cutoff_frequencies(center_frequency: f32, base_bandwidth: f32) -> (f32, f32) {
  let bandwidth =
    compute_modified_dynabandpass_filter_bandwidth(10., base_bandwidth, center_frequency);
  let highpass_freq = clamp(10., NYQUIST - 100., center_frequency - bandwidth / 2.);
  let lowpass_freq = clamp(10., NYQUIST - 100., center_frequency + bandwidth / 2.);
  (lowpass_freq, highpass_freq)
}

const DYNABANDPASS_FILTER_ORDER: usize = 8;

// computed using `compute_higher_order_biquad_q_factors`
const PRECOMPUTED_BASE_Q_FACTORS: [f32; 4] = [-5.852078, -4.417527, -0.91537845, 8.174685];

#[derive(Clone)]
pub struct DynabandpassFilter {
  lowpass_filter_chain: [BiquadFilter; DYNABANDPASS_FILTER_ORDER / 2],
  highpass_filter_chain: [BiquadFilter; DYNABANDPASS_FILTER_ORDER / 2],
  bandwidth: f32,
  lowpass_cutoff_freqs: [f32; FRAME_SIZE],
  highpass_cutoff_freqs: [f32; FRAME_SIZE],
}

impl DynabandpassFilter {
  #[inline]
  pub fn new(bandwidth: f32) -> Self {
    Self {
      lowpass_filter_chain: [BiquadFilter::default(); DYNABANDPASS_FILTER_ORDER / 2],
      highpass_filter_chain: [BiquadFilter::default(); DYNABANDPASS_FILTER_ORDER / 2],
      bandwidth,
      lowpass_cutoff_freqs: [0.; FRAME_SIZE],
      highpass_cutoff_freqs: [0.; FRAME_SIZE],
    }
  }

  #[inline]
  pub fn set_bandwidth(&mut self, bandwidth: f32) { self.bandwidth = bandwidth; }

  /// Called when a voice is gated.  Resets internal filter states to make it like the filter has
  /// been fed silence for an infinite amount of time.
  #[inline]
  pub fn reset(&mut self) {
    for filter in self.lowpass_filter_chain.iter_mut() {
      filter.reset();
    }
    for filter in self.highpass_filter_chain.iter_mut() {
      filter.reset();
    }
  }

  #[inline]
  pub fn apply_frame(&mut self, frame: &mut [f32; FRAME_SIZE], cutoff_freqs: &[f32; FRAME_SIZE]) {
    for i in 0..FRAME_SIZE {
      let (lowpass_freq, highpass_freq) =
        compute_filter_cutoff_frequencies(cutoff_freqs[i], self.bandwidth);
      self.lowpass_cutoff_freqs[i] = lowpass_freq;
      self.highpass_cutoff_freqs[i] = highpass_freq;
    }

    apply_filter_chain_and_compute_coefficients_minimal(
      &mut self.lowpass_filter_chain,
      frame,
      FilterMode::Lowpass,
      &PRECOMPUTED_BASE_Q_FACTORS,
      &self.lowpass_cutoff_freqs,
    );
    apply_filter_chain_and_compute_coefficients_minimal(
      &mut self.highpass_filter_chain,
      frame,
      FilterMode::Highpass,
      &PRECOMPUTED_BASE_Q_FACTORS,
      &self.highpass_cutoff_freqs,
    );
  }

  /// Apply the filter to a single sample with a specific center frequency and bandwidth.
  #[inline]
  pub fn apply_single(&mut self, sample: f32, center_freq: f32, bandwidth: f32) -> f32 {
    let (lowpass_freq, highpass_freq) = compute_filter_cutoff_frequencies(center_freq, bandwidth);

    let mut out = sample;
    for (filter_ix, filter) in self.lowpass_filter_chain.iter_mut().enumerate() {
      out = filter.compute_coefficients_and_apply(
        FilterMode::Lowpass,
        PRECOMPUTED_BASE_Q_FACTORS[filter_ix],
        lowpass_freq,
        0.,
        out,
      );
    }
    for (filter_ix, filter) in self.highpass_filter_chain.iter_mut().enumerate() {
      out = filter.compute_coefficients_and_apply(
        FilterMode::Highpass,
        PRECOMPUTED_BASE_Q_FACTORS[filter_ix],
        highpass_freq,
        0.,
        out,
      );
    }
    out
  }

  /// Compute the frequency response of the dynabandpass filter over a logarithmically spaced grid.
  ///
  /// Returns (frequencies_hz, magnitude_linear, phase_rads)
  pub fn compute_response_grid<T: Float + FloatConst + Default + MulAssign + AddAssign>(
    center_freq: f32,
    bandwidth: f32,
    start_freq: T,
    sample_rate: T,
    grid_points: usize,
  ) -> (Vec<T>, Vec<T>, Vec<T>) {
    let (lowpass_freq, highpass_freq) = compute_filter_cutoff_frequencies(center_freq, bandwidth);

    let lowpass_params: [crate::filters::biquad::ComputeGridFilterParams<T>; 4] =
      std::array::from_fn(|i| crate::filters::biquad::ComputeGridFilterParams {
        q: T::from(PRECOMPUTED_BASE_Q_FACTORS[i]).unwrap(),
        cutoff_freq: T::from(lowpass_freq).unwrap(),
        gain: T::zero(),
      });
    let (freqs, mut mags, mut phases) = BiquadFilter::compute_chain_response_grid(
      FilterMode::Lowpass,
      lowpass_params,
      start_freq,
      sample_rate,
      grid_points,
    );

    let highpass_params: [crate::filters::biquad::ComputeGridFilterParams<T>; 4] =
      std::array::from_fn(|i| crate::filters::biquad::ComputeGridFilterParams {
        q: T::from(PRECOMPUTED_BASE_Q_FACTORS[i]).unwrap(),
        cutoff_freq: T::from(highpass_freq).unwrap(),
        gain: T::zero(),
      });
    let (_freqs, hp_mags, hp_phases) = BiquadFilter::compute_chain_response_grid(
      FilterMode::Highpass,
      highpass_params,
      start_freq,
      sample_rate,
      grid_points,
    );

    for i in 0..grid_points {
      mags[i] *= hp_mags[i];
      phases[i] += hp_phases[i];
    }

    (freqs, mags, phases)
  }
}
