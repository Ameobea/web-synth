use dsp::{
  filters::{
    biquad::{BiquadFilter, FilterMode},
    filter_chain::apply_filter_chain_and_compute_coefficients_minimal,
  },
  FRAME_SIZE, NYQUIST,
};

/// Frequency is a log scale, so we need to increase the bandwidth as the base frequency increases.
///
/// Given the frequency of the center of a band and its width when the band's center is 10 Hz,
/// this function returns the width of the band when the base frequency is the given frequency.
///
/// # Arguments
///
/// * `base_frequency` - The base frequency.
/// * `base_bandwidth` - The base bandwidth.
/// * `frequency` - The frequency for which to compute the modified bandwidth.
///
/// # Returns
///
/// * The computed modified bandwidth.
#[inline]
fn compute_modified_dynabandpass_filter_bandwidth(
  base_frequency: f32,
  base_bandwidth: f32,
  frequency: f32,
) -> f32 {
  let log_base_frequency = (base_frequency + base_bandwidth / 2.0).log10();
  let log_frequency = frequency.log10();
  let log_base_bandwidth = base_bandwidth.log10();

  10f32.powf(log_base_bandwidth + (log_frequency - log_base_frequency))
}

/// Computes the cutoff frequencies for the high-order lowpass and highpass filters that make up the
/// dynabandpass filter.
#[inline]
fn compute_filter_cutoff_frequencies(center_frequency: f32, base_bandwidth: f32) -> (f32, f32) {
  let bandwidth =
    compute_modified_dynabandpass_filter_bandwidth(10., base_bandwidth, center_frequency);
  let highpass_freq = dsp::clamp(10., NYQUIST - 100., center_frequency - bandwidth / 2.);
  let lowpass_freq = dsp::clamp(10., NYQUIST - 100., center_frequency + bandwidth / 2.);
  (lowpass_freq, highpass_freq)
}

const DYNABANDPASS_FILTER_ORDER: usize = 8;

// computed using `compute_higher_order_biquad_q_factors`
const PRECOMPUTED_BASE_Q_FACTORS: [f32; 4] = [-5.852078, -4.417527, -0.91537845, 8.174685];

#[derive(Clone)]
pub(crate) struct DynabandpassFilter {
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
}
