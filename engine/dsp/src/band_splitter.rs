use crate::{
  filters::{
    biquad::{BiquadFilter, FilterMode},
    filter_chain::apply_filter_chain_full,
  },
  FRAME_SIZE,
};

const BAND_SPLITTER_FILTER_ORDER: usize = 16;
const BAND_SPLITTER_FILTER_CHAIN_LENGTH: usize = BAND_SPLITTER_FILTER_ORDER / 2;
const LOW_BAND_CUTOFF: f32 = 88.3;
const MID_BAND_CUTOFF: f32 = 2500.;

pub struct BandSplitter {
  pub low_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH],
  pub mid_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH * 2],
  pub high_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH],
}

// computed using `compute_higher_order_biquad_q_factors`
const Q_FACTORS: [f32; 8] = [
  -5.9786735, -5.638297, -4.929196, -3.7843077, -2.067771, 0.5116703, 4.7229195, 14.153371,
];

impl BandSplitter {
  pub fn new() -> Self {
    let mut low_band_filter_chain = [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
    let mut mid_band_bottom_filter_chain =
      [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
    let mut mid_band_top_filter_chain =
      [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
    let mut high_band_filter_chain = [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
    for i in 0..Q_FACTORS.len() {
      low_band_filter_chain[i].set_coefficients(
        FilterMode::Lowpass,
        Q_FACTORS[i],
        LOW_BAND_CUTOFF,
        0.,
      );
      mid_band_bottom_filter_chain[i].set_coefficients(
        FilterMode::Highpass,
        Q_FACTORS[i],
        LOW_BAND_CUTOFF + 7.5,
        0.,
      );
      mid_band_top_filter_chain[i].set_coefficients(
        FilterMode::Lowpass,
        Q_FACTORS[i],
        MID_BAND_CUTOFF - 184.8,
        0.,
      );
      high_band_filter_chain[i].set_coefficients(
        FilterMode::Highpass,
        Q_FACTORS[i],
        MID_BAND_CUTOFF,
        0.,
      );
    }

    // Mid band is twice as long because it needs top and bottom filters
    let mid_band_filter_chain = [
      mid_band_bottom_filter_chain[0],
      mid_band_bottom_filter_chain[1],
      mid_band_bottom_filter_chain[2],
      mid_band_bottom_filter_chain[3],
      mid_band_bottom_filter_chain[4],
      mid_band_bottom_filter_chain[5],
      mid_band_bottom_filter_chain[6],
      mid_band_bottom_filter_chain[7],
      mid_band_top_filter_chain[0],
      mid_band_top_filter_chain[1],
      mid_band_top_filter_chain[2],
      mid_band_top_filter_chain[3],
      mid_band_top_filter_chain[4],
      mid_band_top_filter_chain[5],
      mid_band_top_filter_chain[6],
      mid_band_top_filter_chain[7],
    ];

    Self {
      low_band_filter_chain,
      mid_band_filter_chain,
      high_band_filter_chain,
    }
  }

  pub fn apply_frame(
    &mut self,
    samples: &[f32; FRAME_SIZE],
    low_band_output_buf: &mut [f32; FRAME_SIZE],
    mid_band_output_buf: &mut [f32; FRAME_SIZE],
    high_band_output_buf: &mut [f32; FRAME_SIZE],
  ) {
    apply_filter_chain_full(
      &mut self.low_band_filter_chain,
      *samples,
      low_band_output_buf,
    );
    apply_filter_chain_full(
      &mut self.mid_band_filter_chain,
      *samples,
      mid_band_output_buf,
    );
    apply_filter_chain_full(
      &mut self.high_band_filter_chain,
      *samples,
      high_band_output_buf,
    );
  }
}
