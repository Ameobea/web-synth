use dsp::{
  circular_buffer::CircularBuffer,
  db_to_gain,
  filters::{
    biquad::{BiquadFilter, FilterMode},
    dc_blocker::DCBlocker,
  },
  gain_to_db, SAMPLE_RATE,
};

const FRAME_SIZE: usize = 128;

const BAND_SPLITTER_FILTER_ORDER: usize = 16;
const BAND_SPLITTER_FILTER_CHAIN_LENGTH: usize = BAND_SPLITTER_FILTER_ORDER / 2;
const MAX_UPWARD_GAIN_DB: f32 = 24.;
const LOW_BAND_CUTOFF: f32 = 88.3;
const MID_BAND_CUTOFF: f32 = 2500.;
const SAB_SIZE: usize = 16;

// Must hold >= FRAME_SIZE + max runtime lookahead; UI caps lookahead at ~33 ms.
pub const MAX_LOOKAHEAD_SAMPLES: usize = SAMPLE_RATE as usize / 15;

#[repr(C)]
pub enum LogLevel {
  Error = 0,
  Warn = 1,
  Info = 2,
}

#[cfg(all(feature = "exports", target_arch = "wasm32"))]
#[link(wasm_import_module = "env")]
extern "C" {
  pub fn log_raw(ptr: *const u8, len: usize, level: LogLevel);
}

#[cfg(all(feature = "exports", target_arch = "wasm32"))]
fn error(msg: &str) {
  unsafe {
    log_raw(msg.as_ptr(), msg.len(), LogLevel::Error);
  }
}

#[cfg(all(feature = "exports", not(target_arch = "wasm32")))]
extern "C" fn log_raw(_ptr: *const u8, _len: usize, _level: LogLevel) {}

#[cfg(all(feature = "exports", not(target_arch = "wasm32")))]
fn error(_msg: &str) {}

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
  pub envelope: f32,
  pub last_detected_level_db: f32,
  pub last_output_level_db: f32,
  pub last_applied_gain: f32,
  pub rms_filter_state: f32,
  pub rms_dc_blocker: DCBlocker,
  /// Per-sample gain reduction in dB.
  pub gr_buf: CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
}

impl Default for Compressor {
  fn default() -> Self {
    Self {
      envelope: -100.,
      last_detected_level_db: -100.,
      last_output_level_db: -100.,
      last_applied_gain: 1.,
      rms_filter_state: 0.,
      rms_dc_blocker: DCBlocker::default(),
      gr_buf: CircularBuffer::new(),
    }
  }
}

#[derive(Clone)]
pub struct MultibandCompressor {
  pub input_buffer: [f32; FRAME_SIZE],
  pub low_band_lookahead_buf: CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
  pub mid_band_lookahead_buf: CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
  pub high_band_lookahead_buf: CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
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
      input_buffer: [0.0; FRAME_SIZE],
      low_band_lookahead_buf: CircularBuffer::new(),
      mid_band_lookahead_buf: CircularBuffer::new(),
      high_band_lookahead_buf: CircularBuffer::new(),
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

fn apply_filter_chain_to_lookahead_buf<const N: usize>(
  chain: &mut [BiquadFilter; N],
  input_buf: &[f32; FRAME_SIZE],
  lookahead_buf: &mut CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
  gain: f32,
) {
  let mut frame = *input_buf;
  for filter in chain.iter_mut() {
    for i in 0..FRAME_SIZE {
      frame[i] = filter.apply(frame[i]);
    }
  }
  for i in 0..FRAME_SIZE {
    lookahead_buf.set(frame[i] * gain);
  }
}

fn compute_one_pole_filter_coefficient(time_ms: f32) -> f32 {
  let time_s = (time_ms * 0.001).max(1. / SAMPLE_RATE);
  let pole = (-1. / (time_s * SAMPLE_RATE)).exp();
  1. - pole
}

impl Compressor {
  pub fn apply(
    &mut self,
    input_buf: &CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
    lookahead_samples: isize,
    output_buf: &mut [f32; FRAME_SIZE],
    attack_ms: f32,
    release_ms: f32,
    bottom_threshold_db: f32,
    top_threshold_db: f32,
    bottom_ratio: f32,
    top_ratio: f32,
    knee_db: f32,
    post_gain: f32,
    rms_level_detector_coefficient: f32,
    backwards_ramp: bool,
  ) -> f32 {
    let attack_coeff = compute_one_pole_filter_coefficient(attack_ms);
    let release_coeff = compute_one_pole_filter_coefficient(release_ms);

    let mut last_detected_db = self.last_detected_level_db;
    let mut envelope = self.envelope;
    let mut rms_state = self.rms_filter_state;
    let mut last_output_db = self.last_output_level_db;
    let mut last_gain = self.last_applied_gain;

    let knee_width = knee_db.max(0.);
    let knee_half = knee_width / 2.;
    let top_knee_lower = top_threshold_db - knee_half;
    let top_knee_upper = top_threshold_db + knee_half;

    let top_slope_factor = 1. - 1. / top_ratio.max(1.);

    // After the bandsplitter wrote FRAME_SIZE samples to `input_buf`, sample i of the new frame
    // sits at offset -(FRAME_SIZE-1-i) from head.
    for i in 0..FRAME_SIZE {
      let newest_off = -((FRAME_SIZE - 1 - i) as isize);
      let newest_sample = input_buf.get(newest_off);

      let detected_level_linear = {
        let x = self.rms_dc_blocker.apply(newest_sample);
        let x = x * x;
        let y =
          rms_level_detector_coefficient * x + (1. - rms_level_detector_coefficient) * rms_state;
        rms_state = y.max(0.);
        y.sqrt()
      };

      let detected_db = gain_to_db(detected_level_linear.max(1e-10));
      last_detected_db = detected_db;

      let coeff = if detected_db > envelope {
        attack_coeff
      } else {
        release_coeff
      };
      envelope += coeff * (detected_db - envelope);

      let mut total_gain_db = 0.;

      if envelope > top_knee_lower {
        let overshoot_db = if envelope < top_knee_upper {
          let distance_into_knee = envelope - top_knee_lower;
          (distance_into_knee * distance_into_knee) / (2.0 * knee_width)
        } else {
          envelope - top_threshold_db
        };

        total_gain_db += -overshoot_db * top_slope_factor;
      }

      if envelope < bottom_threshold_db {
        let diff = bottom_threshold_db - envelope.max(-100.);
        let raw_boost = diff * (1. - bottom_ratio);
        total_gain_db += raw_boost.min(MAX_UPWARD_GAIN_DB);
      }

      self.gr_buf.set(total_gain_db);

      last_output_db = detected_db + total_gain_db;
    }

    // Backwards-ramp smoothing, based on:
    // https://github.com/DanielRudrich/SimpleCompressor/blob/master/docs/lookAheadLimiter.md
    //
    // Walks the GR buffer backwards applying a linear dB ramp into each local minimum so the
    // envelope fades into peaks instead of snapping.  Only the downward component is smoothed;
    // upward expansion passes through.
    if backwards_ramp && lookahead_samples > 0 {
      let lookahead = lookahead_samples as f32;
      let mut next_gr_db = 0.0f32;
      let mut step_db = 0.0f32;
      let total = FRAME_SIZE + lookahead_samples as usize;
      for offset in 0..total {
        let ix = -(offset as isize);
        let smpl = self.gr_buf.get(ix);
        let smpl_neg = smpl.min(0.0);

        if smpl_neg > next_gr_db {
          // overwrite with ramp value; preserve upward component
          let smpl_pos = smpl - smpl_neg;
          self.gr_buf.set_at(ix, next_gr_db + smpl_pos);
          next_gr_db += step_db;
        } else if offset < FRAME_SIZE {
          // deeper peak in new frame; restart ramp toward it
          step_db = -smpl_neg / lookahead;
          next_gr_db = smpl_neg + step_db;
        } else {
          // deeper peak in already-smoothed history; prior call ramped it
          break;
        }
      }
    }

    // Snap mode reads gain at the newest offset (leads delayed audio by lookahead_samples =
    // brick-wall). Backwards-ramp reads at the delayed offset since the ramp was applied in place.
    for i in 0..FRAME_SIZE {
      let newest_off = -((FRAME_SIZE - 1 - i) as isize);
      let delayed_off = newest_off - lookahead_samples;
      let gr_off = if backwards_ramp { delayed_off } else { newest_off };
      let gain_linear = db_to_gain(self.gr_buf.get(gr_off));
      last_gain = gain_linear;
      output_buf[i] += input_buf.get(delayed_off) * gain_linear * post_gain;
    }

    self.envelope = envelope;
    self.rms_filter_state = rms_state;
    self.last_detected_level_db = last_detected_db;
    self.last_output_level_db = last_output_db;
    self.last_applied_gain = last_gain;

    last_detected_db
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
    apply_filter_chain_to_lookahead_buf(
      &mut self.low_band_filter_chain,
      &self.input_buffer,
      &mut self.low_band_lookahead_buf,
      low_band_gain,
    );
    apply_filter_chain_to_lookahead_buf(
      &mut self.mid_band_filter_chain,
      &self.input_buffer,
      &mut self.mid_band_lookahead_buf,
      mid_band_gain,
    );
    apply_filter_chain_to_lookahead_buf(
      &mut self.high_band_filter_chain,
      &self.input_buffer,
      &mut self.high_band_lookahead_buf,
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
    knee_db: f32,
    low_band_post_gain: f32,
    mid_band_post_gain: f32,
    high_band_post_gain: f32,
    lookahead_samples: usize,
    backwards_ramp: bool,
  ) {
    if pre_gain != 1. {
      for i in 0..FRAME_SIZE {
        self.input_buffer[i] *= pre_gain;
      }
    }

    self.apply_bandsplitting(low_band_pre_gain, mid_band_pre_gain, high_band_pre_gain);

    self.output_buffer.fill(0.);

    let lookahead = (lookahead_samples.min(MAX_LOOKAHEAD_SAMPLES - FRAME_SIZE - 1)) as isize;

    if mix < 1.0 {
      let dry_gain = 1. - mix;
      for buf in &[
        &self.low_band_lookahead_buf,
        &self.mid_band_lookahead_buf,
        &self.high_band_lookahead_buf,
      ] {
        for i in 0..FRAME_SIZE {
          let off = -((FRAME_SIZE - 1 - i) as isize) - lookahead;
          self.output_buffer[i] += buf.get(off) * dry_gain;
        }
      }
    }

    let low_band_rms_level_detector_coefficient =
      compute_one_pole_filter_coefficient(low_band_attack_ms.min(30.));
    let mid_band_rms_level_detector_coefficient =
      compute_one_pole_filter_coefficient(mid_band_attack_ms.min(5.));
    let high_band_rms_level_detector_coefficient =
      compute_one_pole_filter_coefficient(high_band_attack_ms.min(1.));

    let low_level = self.low_band_compressor.apply(
      &self.low_band_lookahead_buf,
      lookahead,
      &mut self.output_buffer,
      low_band_attack_ms,
      low_band_release_ms,
      low_band_bottom_threshold_db,
      low_band_top_threshold_db,
      low_band_bottom_ratio,
      low_band_top_ratio,
      knee_db,
      low_band_post_gain * mix,
      low_band_rms_level_detector_coefficient,
      backwards_ramp,
    );
    self.sab[0] = low_level;
    self.sab[3] = self.low_band_compressor.envelope;
    self.sab[6] = self.low_band_compressor.last_output_level_db;
    self.sab[9] = self.low_band_compressor.last_applied_gain;

    let mid_level = self.mid_band_compressor.apply(
      &self.mid_band_lookahead_buf,
      lookahead,
      &mut self.output_buffer,
      mid_band_attack_ms,
      mid_band_release_ms,
      mid_band_bottom_threshold_db,
      mid_band_top_threshold_db,
      mid_band_bottom_ratio,
      mid_band_top_ratio,
      knee_db,
      mid_band_post_gain * mix,
      mid_band_rms_level_detector_coefficient,
      backwards_ramp,
    );
    self.sab[1] = mid_level;
    self.sab[4] = self.mid_band_compressor.envelope;
    self.sab[7] = self.mid_band_compressor.last_output_level_db;
    self.sab[10] = self.mid_band_compressor.last_applied_gain;

    let high_level = self.high_band_compressor.apply(
      &self.high_band_lookahead_buf,
      lookahead,
      &mut self.output_buffer,
      high_band_attack_ms,
      high_band_release_ms,
      high_band_bottom_threshold_db,
      high_band_top_threshold_db,
      high_band_bottom_ratio,
      high_band_top_ratio,
      knee_db,
      high_band_post_gain * mix,
      high_band_rms_level_detector_coefficient,
      backwards_ramp,
    );
    self.sab[2] = high_level;
    self.sab[5] = self.high_band_compressor.envelope;
    self.sab[8] = self.high_band_compressor.last_output_level_db;
    self.sab[11] = self.high_band_compressor.last_applied_gain;

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
  low_band_post_gain: f32,
  mid_band_post_gain: f32,
  high_band_post_gain: f32,
  lookahead_samples: usize,
  backwards_ramp: u32,
) {
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
    low_band_post_gain,
    mid_band_post_gain,
    high_band_post_gain,
    lookahead_samples,
    backwards_ramp != 0,
  );
}
