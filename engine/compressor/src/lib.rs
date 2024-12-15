#![feature(const_float_methods)]

use dsp::{
  circular_buffer::CircularBuffer,
  db_to_gain,
  filters::biquad::{BiquadFilter, FilterMode},
  gain_to_db, SAMPLE_RATE,
};

const FRAME_SIZE: usize = 128;

#[repr(u8)]
#[derive(Clone, Copy)]
pub enum SensingMethod {
  Peak = 0,
  RMS = 1,
}

const BAND_SPLITTER_FILTER_ORDER: usize = 16;
const BAND_SPLITTER_FILTER_CHAIN_LENGTH: usize = BAND_SPLITTER_FILTER_ORDER / 2;
const MAX_LOOKAHEAD_SAMPLES: usize = SAMPLE_RATE as usize / 15;
const LOW_BAND_CUTOFF: f32 = 88.3;
const MID_BAND_CUTOFF: f32 = 2500.;
const SAB_SIZE: usize = 16;

#[repr(C)]
pub enum LogLevel {
  Error = 0,
  Warn = 1,
  Info = 2,
}

extern "C" {
  pub fn log_raw(ptr: *const u8, len: usize, level: LogLevel);
}

fn error(msg: &str) {
  unsafe {
    log_raw(msg.as_ptr(), msg.len(), LogLevel::Error);
  }
}

// SAB Layout:
// 0: low band detected level
// 1: mid band detected level
// 2: high band detected level
// 3: low band envelope level
// 4: mid band envelope level
// 5: high band envelope level
// 6: low band output level
// 7: mid band output level
// 8: high band output level
// 9: low band applied gain
// 10: mid band applied gain
// 11: high band applied gain

#[derive(Clone)]
pub struct Compressor {
  pub bottom_envelope: f32,
  pub top_envelope: f32,
  pub last_detected_level_linear: f32,
  pub last_output_level_db: f32,
  pub last_applied_gain: f32,
  pub lookback_period_squared_samples_sum: f32,
  pub detected_level_history: CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
}

impl Default for Compressor {
  fn default() -> Self {
    Self {
      bottom_envelope: 0.,
      top_envelope: 0.,
      last_detected_level_linear: 0.,
      last_output_level_db: 0.,
      last_applied_gain: 0.,
      lookback_period_squared_samples_sum: 0.,
      detected_level_history: CircularBuffer::new(),
    }
  }
}

#[derive(Clone)]
pub struct MultibandCompressor {
  pub sensing_method: SensingMethod,
  pub input_buffer: [f32; FRAME_SIZE],
  pub low_band_lookahead_buffer: CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
  pub mid_band_lookahead_buffer: CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
  pub high_band_lookahead_buffer: CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
  pub low_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH],
  pub mid_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH * 2],
  pub high_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH],
  pub low_band_compressor: Compressor,
  pub mid_band_compressor: Compressor,
  pub high_band_compressor: Compressor,
  pub output_buffer: [f32; FRAME_SIZE],
  pub sab: [f32; SAB_SIZE],
  pub mix_state: f32,
}

// computed with `compute_higher_order_biquad_q_factors`
const PRECOMPUTED_Q_FACTORS: [f32; BAND_SPLITTER_FILTER_ORDER / 2] = [
  -5.9786735, -5.638297, -4.929196, -3.7843077, -2.067771, 0.5116703, 4.7229195, 14.153371,
];

impl Default for MultibandCompressor {
  fn default() -> Self {
    let mut low_band_filter_chain = [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
    let mut mid_band_bottom_filter_chain =
      [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
    let mut mid_band_top_filter_chain =
      [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
    let mut high_band_filter_chain = [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
    for i in 0..PRECOMPUTED_Q_FACTORS.len() {
      low_band_filter_chain[i].set_coefficients(
        FilterMode::Lowpass,
        PRECOMPUTED_Q_FACTORS[i],
        LOW_BAND_CUTOFF,
        0.,
      );
      mid_band_bottom_filter_chain[i].set_coefficients(
        FilterMode::Highpass,
        PRECOMPUTED_Q_FACTORS[i],
        LOW_BAND_CUTOFF + 7.5,
        0.,
      );
      mid_band_top_filter_chain[i].set_coefficients(
        FilterMode::Lowpass,
        PRECOMPUTED_Q_FACTORS[i],
        MID_BAND_CUTOFF - 184.8,
        0.,
      );
      high_band_filter_chain[i].set_coefficients(
        FilterMode::Highpass,
        PRECOMPUTED_Q_FACTORS[i],
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
      sensing_method: SensingMethod::Peak,
      input_buffer: [0.0; FRAME_SIZE],
      low_band_lookahead_buffer: CircularBuffer::new(),
      mid_band_lookahead_buffer: CircularBuffer::new(),
      high_band_lookahead_buffer: CircularBuffer::new(),
      low_band_filter_chain,
      mid_band_filter_chain,
      high_band_filter_chain,
      low_band_compressor: Compressor::default(),
      mid_band_compressor: Compressor::default(),
      high_band_compressor: Compressor::default(),
      output_buffer: [0.0; FRAME_SIZE],
      sab: [0.0; SAB_SIZE],
      mix_state: 0.,
    }
  }
}

fn apply_filter_chain_full<const N: usize>(
  chain: &mut [BiquadFilter; N],
  input_buf: [f32; FRAME_SIZE],
  output_lookahead_buf: &mut CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
  gain: f32,
) {
  let mut filtered = input_buf;
  for filter in chain.iter_mut() {
    for i in 0..FRAME_SIZE {
      filtered[i] = filter.apply(filtered[i]);
    }
  }

  for i in 0..FRAME_SIZE {
    output_lookahead_buf.set(filtered[i] * gain);
  }
}

#[inline(never)]
fn detect_level_peak(
  buf: &CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
  lookahead_samples: isize,
  sample_ix_in_frame: usize,
  _old_max: f32,
) -> f32 {
  // Try to fast-path.  If the old max hasn't been removed from the lookahead buffer yet and it's
  // still the max, then we can just return it.
  // let cur_sample = buf
  //     .get(-(FRAME_SIZE as isize) + sample_ix_in_frame as isize)
  //     .abs();
  // let removed_sample_ix = -lookahead_samples - FRAME_SIZE as isize + sample_ix_in_frame as
  // isize; let removed_sample = buf.get(removed_sample_ix);
  // if removed_sample != old_max {
  //     return cur_sample.max(old_max);
  // }

  // Might be cool to SIMD-ize this if we can't figure out a more efficient level detection method
  let mut max = 0.;
  for i in 0..lookahead_samples {
    let ix = -lookahead_samples - FRAME_SIZE as isize + sample_ix_in_frame as isize + i;
    let abs_sample = buf.get(ix).abs();
    if abs_sample > max {
      max = abs_sample;
    }
  }
  max
}

/// Given the attack time in milliseconds, compute the coefficient for a one-pole lowpass filter to
/// be used in the envelope follower.
pub const fn compute_attack_coefficient(attack_time_ms: f32) -> f32 {
  let attack_time_s = (attack_time_ms * 0.001).max(0.0001);
  let attack_time_samples = attack_time_s * SAMPLE_RATE;
  let attack_coefficient = 1. - 1. / attack_time_samples;
  attack_coefficient
}

/// Given the release time in milliseconds, compute the coefficient for a one-pole highpass filter
/// to be used in the envelope follower.
pub const fn compute_release_coefficient(release_time_ms: f32) -> f32 {
  let release_time_s = (release_time_ms * 0.001).max(0.0001);
  let release_time_samples = release_time_s * SAMPLE_RATE;
  let release_coefficient = 1. / release_time_samples;
  release_coefficient
}

/// Given a frame of samples, computes the average volume of the frame in decibels.
fn detect_level_rms(
  buf: &CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
  lookahead_samples: isize,
  sample_ix_in_frame: usize,
  lookback_period_squared_samples_sum: &mut f32,
) -> f32 {
  let prev_ix = -lookahead_samples - FRAME_SIZE as isize + sample_ix_in_frame as isize - 1;
  let removed_sample = buf.get(prev_ix);
  *lookback_period_squared_samples_sum -= removed_sample * removed_sample;

  let cur_ix = -(FRAME_SIZE as isize) + sample_ix_in_frame as isize;
  let cur_sample = buf.get(cur_ix);
  *lookback_period_squared_samples_sum += cur_sample * cur_sample;

  if *lookback_period_squared_samples_sum < 0.0001 {
    *lookback_period_squared_samples_sum = 0.;
  } else if lookback_period_squared_samples_sum.is_nan()
    || lookback_period_squared_samples_sum.is_infinite()
  {
    panic!("{}, {}", *lookback_period_squared_samples_sum, cur_sample);
  }

  (*lookback_period_squared_samples_sum / lookahead_samples as f32).sqrt()
}

impl Compressor {
  pub fn apply(
    &mut self,
    input_buf: &CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
    lookahead_samples: usize,
    output_buf: &mut [f32; FRAME_SIZE],
    attack_ms: f32,
    release_ms: f32,
    bottom_threshold_db: f32,
    top_threshold_db: f32,
    bottom_ratio: f32,
    top_ratio: f32,
    _knee: f32,
    sensing_method: SensingMethod,
    post_gain: f32,
  ) -> f32 {
    let mut bottom_envelope = self.bottom_envelope;
    let mut top_envelope = self.top_envelope;

    let lookahead_samples = lookahead_samples as isize;
    let attack_coefficient = compute_attack_coefficient(attack_ms);
    let release_coefficient = compute_release_coefficient(release_ms);

    let mut detected_level_db = self.last_output_level_db;
    let mut detected_level_linear = self.last_detected_level_linear;
    let mut target_volume_db = detected_level_db;
    let mut gain = 1.;

    for i in 0..FRAME_SIZE {
      let input = input_buf.get(-lookahead_samples - FRAME_SIZE as isize + i as isize);

      detected_level_linear = match sensing_method {
        SensingMethod::Peak =>
          detect_level_peak(input_buf, lookahead_samples, i, detected_level_linear),
        SensingMethod::RMS => detect_level_rms(
          input_buf,
          lookahead_samples,
          i,
          &mut self.lookback_period_squared_samples_sum,
        ),
      };
      if detected_level_linear.is_nan() || !detected_level_db.is_finite() {
        detected_level_linear = 0.;
      }

      // I have no idea if this is right, and if I had to guess I'd say it's wrong
      self.detected_level_history.set(detected_level_linear);
      let detected_level_linear = self.detected_level_history.get(-lookahead_samples / 2);

      detected_level_db = gain_to_db(detected_level_linear);

      // Compute the envelope
      if detected_level_db > top_envelope {
        top_envelope =
          attack_coefficient * top_envelope + (1. - attack_coefficient) * detected_level_db;
      } else {
        top_envelope =
          release_coefficient * top_envelope + (1. - release_coefficient) * detected_level_db;
      }
      if cfg!(debug_assertions) && (top_envelope.is_nan() || top_envelope.is_infinite()) {
        panic!(
          "top_envelope={top_envelope}, detected_level_linear={detected_level_linear}, \
           detected_level_db={detected_level_db}, attack_coefficient={attack_coefficient}, \
           release_coefficient={release_coefficient}, input={input}, i={i}, \
           lookahead_samples={lookahead_samples}"
        );
      }

      if detected_level_db < bottom_envelope {
        bottom_envelope =
          attack_coefficient * bottom_envelope + (1. - attack_coefficient) * detected_level_db;
      } else {
        bottom_envelope =
          release_coefficient * bottom_envelope + (1. - release_coefficient) * detected_level_db;
      }
      if cfg!(debug_assertions) && (bottom_envelope.is_nan() || bottom_envelope.is_infinite()) {
        panic!(
          "bottom_envelope={bottom_envelope}, detected_level_linear={detected_level_linear}, \
           detected_level_db={detected_level_db}, attack_coefficient={attack_coefficient}, \
           release_coefficient={release_coefficient}, input={input}, i={i}, \
           lookahead_samples={lookahead_samples}"
        );
      }

      // Compute the gain.
      // TODO: Add support for soft knee
      gain = if top_envelope > top_threshold_db {
        // Push the volume down towards the top threshold
        target_volume_db = top_threshold_db + (top_envelope - top_threshold_db) / top_ratio;
        if cfg!(debug_assertions) && (target_volume_db.is_infinite() || target_volume_db.is_nan()) {
          panic!(
            "top_envelope={top_envelope}, top_threshold_db={top_threshold_db}, \
             top_ratio={top_ratio}, target_volume_db={target_volume_db}"
          );
        }
        db_to_gain(target_volume_db - top_envelope)
      } else if bottom_envelope < bottom_threshold_db {
        // Push the volume up towards the bottom threshold
        target_volume_db =
          bottom_threshold_db - (bottom_threshold_db - bottom_envelope) * bottom_ratio;
        if cfg!(debug_assertions) && (target_volume_db.is_infinite() || target_volume_db.is_nan()) {
          panic!(
            "bottom_envelope={bottom_envelope}, bottom_threshold_db={bottom_threshold_db}, \
             bottom_ratio={bottom_ratio}, target_volume_db={target_volume_db}"
          );
        }
        db_to_gain(target_volume_db - bottom_envelope).min(3.)
      } else {
        target_volume_db = top_envelope;
        if cfg!(debug_assertions) && (target_volume_db.is_infinite() || target_volume_db.is_nan()) {
          panic!("top_envelope={top_envelope}, target_volume_db={target_volume_db}");
        }
        1.
      };

      let output = input * gain * post_gain;
      if cfg!(debug_assertions) && output.is_infinite() || output.is_nan() {
        panic!("input={input}, gain={gain}, post_gain={post_gain}, output={output}");
      }
      output_buf[i] += output;
    }

    self.bottom_envelope = bottom_envelope;
    self.top_envelope = top_envelope;
    self.last_detected_level_linear = detected_level_linear;
    self.last_output_level_db = target_volume_db;
    self.last_applied_gain = gain;
    detected_level_db
  }
}

impl MultibandCompressor {
  #[inline]
  pub fn apply_bandsplitting(
    &mut self,
    low_band_gain: f32,
    mid_band_gain: f32,
    high_band_gain: f32,
  ) {
    apply_filter_chain_full(
      &mut self.low_band_filter_chain,
      self.input_buffer,
      &mut self.low_band_lookahead_buffer,
      low_band_gain,
    );
    apply_filter_chain_full(
      &mut self.mid_band_filter_chain,
      self.input_buffer,
      &mut self.mid_band_lookahead_buffer,
      mid_band_gain,
    );
    apply_filter_chain_full(
      &mut self.high_band_filter_chain,
      self.input_buffer,
      &mut self.high_band_lookahead_buffer,
      high_band_gain,
    );
  }

  #[inline]
  pub fn apply(
    &mut self,
    mix: f32,
    pre_gain: f32,
    post_gain: f32,
    low_band_pre_gain: f32,
    mid_band_pre_gain: f32,
    high_band_pre_gain: f32,
    low_band_attack_ms: f32,
    low_band_release_ms: f32,
    mid_band_attack_ms: f32,
    mid_band_release_ms: f32,
    high_band_attack_ms: f32,
    high_band_release_ms: f32,
    low_band_bottom_threshold_db: f32,
    mid_band_bottom_threshold_db: f32,
    high_band_bottom_threshold_db: f32,
    low_band_top_threshold_db: f32,
    mid_band_top_threshold_db: f32,
    high_band_top_threshold_db: f32,
    low_band_bottom_ratio: f32,
    mid_band_bottom_ratio: f32,
    high_band_bottom_ratio: f32,
    low_band_top_ratio: f32,
    mid_band_top_ratio: f32,
    high_band_top_ratio: f32,
    knee: f32,
    lookahead_samples: usize,
    low_band_post_gain: f32,
    mid_band_post_gain: f32,
    high_band_post_gain: f32,
  ) {
    // apply pre gain
    if pre_gain != 1. {
      for i in 0..FRAME_SIZE {
        self.input_buffer[i] *= pre_gain;
      }
    }

    self.apply_bandsplitting(low_band_pre_gain, mid_band_pre_gain, high_band_pre_gain);

    self.output_buffer.fill(0.);
    if mix != 1. {
      let lookahead_samples = lookahead_samples as isize;
      for input_buf in &[
        &self.low_band_lookahead_buffer,
        &self.mid_band_lookahead_buffer,
        &self.high_band_lookahead_buffer,
      ] {
        for i in 0..FRAME_SIZE {
          let ix = -lookahead_samples - FRAME_SIZE as isize + i as isize;
          let input = input_buf.get(ix);
          let mix = dsp::smooth(&mut self.mix_state, mix, 0.995);
          self.output_buffer[i] += input * (1. - mix);
        }
      }
    }

    // Apply compression to each band
    let sensing_method = SensingMethod::RMS;
    let low_band_detected_level = self.low_band_compressor.apply(
      &self.low_band_lookahead_buffer,
      lookahead_samples,
      &mut self.output_buffer,
      low_band_attack_ms,
      low_band_release_ms,
      low_band_bottom_threshold_db,
      low_band_top_threshold_db,
      low_band_bottom_ratio,
      low_band_top_ratio,
      knee,
      sensing_method,
      low_band_post_gain * mix,
    );
    self.sab[0] = low_band_detected_level;
    self.sab[3] = self.low_band_compressor.bottom_envelope;
    self.sab[6] = self.low_band_compressor.last_output_level_db;
    self.sab[9] = self.low_band_compressor.last_applied_gain;
    let mid_band_detected_level = self.mid_band_compressor.apply(
      &self.mid_band_lookahead_buffer,
      lookahead_samples,
      &mut self.output_buffer,
      mid_band_attack_ms,
      mid_band_release_ms,
      mid_band_bottom_threshold_db,
      mid_band_top_threshold_db,
      mid_band_bottom_ratio,
      mid_band_top_ratio,
      knee,
      sensing_method,
      mid_band_post_gain * mix,
    );
    self.sab[1] = mid_band_detected_level;
    self.sab[4] = self.mid_band_compressor.bottom_envelope;
    self.sab[7] = self.mid_band_compressor.last_output_level_db;
    self.sab[10] = self.mid_band_compressor.last_applied_gain;
    let high_band_detected_level = self.high_band_compressor.apply(
      &self.high_band_lookahead_buffer,
      lookahead_samples,
      &mut self.output_buffer,
      high_band_attack_ms,
      high_band_release_ms,
      high_band_bottom_threshold_db,
      high_band_top_threshold_db,
      high_band_bottom_ratio,
      high_band_top_ratio,
      knee,
      sensing_method,
      high_band_post_gain * mix,
    );
    self.sab[2] = high_band_detected_level;
    self.sab[5] = self.high_band_compressor.bottom_envelope;
    self.sab[8] = self.high_band_compressor.last_output_level_db;
    self.sab[11] = self.high_band_compressor.last_applied_gain;

    // apply post gain
    if post_gain != 1. {
      for i in 0..FRAME_SIZE {
        self.output_buffer[i] *= post_gain;
      }
    }
  }
}

#[cfg(feature = "exports")]
#[no_mangle]
pub extern "C" fn init_compressor() -> *mut MultibandCompressor {
  use std::fmt::Write;
  std::panic::set_hook(Box::new(|panic_info| {
    // log with `error`
    let mut buf = String::new();
    let _ = write!(buf, "panic: {}", panic_info.to_string());
    error(&buf);
  }));

  let compressor = MultibandCompressor::default();
  Box::into_raw(Box::new(compressor))
}

#[cfg(feature = "exports")]
#[no_mangle]
pub extern "C" fn get_compressor_input_buf_ptr(compressor: *mut MultibandCompressor) -> *mut f32 {
  let compressor = unsafe { &mut *compressor };
  compressor.input_buffer.as_mut_ptr()
}

#[cfg(feature = "exports")]
#[no_mangle]
pub extern "C" fn get_compressor_output_buf_ptr(compressor: *mut MultibandCompressor) -> *mut f32 {
  let compressor = unsafe { &mut *compressor };
  compressor.output_buffer.as_mut_ptr()
}

#[cfg(feature = "exports")]
#[no_mangle]
pub extern "C" fn get_sab_ptr(compressor: *mut MultibandCompressor) -> *mut f32 {
  let compressor = unsafe { &mut *compressor };
  compressor.sab.as_mut_ptr()
}

#[cfg(feature = "exports")]
#[no_mangle]
pub extern "C" fn process_compressor(
  compressor: *mut MultibandCompressor,
  mix: f32,
  pre_gain: f32,
  post_gain: f32,
  low_band_pre_gain: f32,
  mid_band_pre_gain: f32,
  high_band_pre_gain: f32,
  low_band_attack_ms: f32,
  low_band_release_ms: f32,
  mid_band_attack_ms: f32,
  mid_band_release_ms: f32,
  high_band_attack_ms: f32,
  high_band_release_ms: f32,
  low_band_bottom_threshold_db: f32,
  mid_band_bottom_threshold_db: f32,
  high_band_bottom_threshold_db: f32,
  low_band_top_threshold_db: f32,
  mid_band_top_threshold_db: f32,
  high_band_top_threshold_db: f32,
  low_band_bottom_ratio: f32,
  mid_band_bottom_ratio: f32,
  high_band_bottom_ratio: f32,
  low_band_top_ratio: f32,
  mid_band_top_ratio: f32,
  high_band_top_ratio: f32,
  knee: f32,
  lookahead_samples: usize,
) {
  // let low_band_pre_gain = low_band_pre_gain * db_to_gain(5.2);
  let low_band_pre_gain = low_band_pre_gain * 1.8197008586099834;
  // let mid_band_pre_gain = mid_band_pre_gain * db_to_gain(5.2);
  let mid_band_pre_gain = mid_band_pre_gain * 1.8197008586099834;
  // let high_band_pre_gain = high_band_pre_gain * db_to_gain(5.2);
  let high_band_pre_gain = high_band_pre_gain * 1.8197008586099834;
  // let low_band_post_gain = db_to_gain(10.3);
  let low_band_post_gain = 3.273406948788382;
  // let mid_band_post_gain = db_to_gain(5.7);
  let mid_band_post_gain = 1.9275249131909362;
  // let high_band_post_gain = db_to_gain(10.3);
  let high_band_post_gain = 3.273406948788382;

  let compressor = unsafe { &mut *compressor };
  compressor.apply(
    mix,
    pre_gain,
    post_gain,
    low_band_pre_gain,
    mid_band_pre_gain,
    high_band_pre_gain,
    low_band_attack_ms,
    low_band_release_ms,
    mid_band_attack_ms,
    mid_band_release_ms,
    high_band_attack_ms,
    high_band_release_ms,
    low_band_bottom_threshold_db,
    mid_band_bottom_threshold_db,
    high_band_bottom_threshold_db,
    low_band_top_threshold_db,
    mid_band_top_threshold_db,
    high_band_top_threshold_db,
    low_band_bottom_ratio,
    mid_band_bottom_ratio,
    high_band_bottom_ratio,
    low_band_top_ratio,
    mid_band_top_ratio,
    high_band_top_ratio,
    knee,
    lookahead_samples,
    low_band_post_gain,
    mid_band_post_gain,
    high_band_post_gain,
  );
}
