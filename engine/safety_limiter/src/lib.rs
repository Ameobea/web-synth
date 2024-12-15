use std::ptr::{addr_of, addr_of_mut};

use dsp::db_to_gain;

static mut IO_BUFFER: [f32; dsp::FRAME_SIZE] = [0.0; dsp::FRAME_SIZE];

// SAB format:
//  0: detected level dB
//  1: output level dB
//  2: applied gain
const SAB_SIZE: usize = 3;
static mut SAB: [f32; SAB_SIZE] = [0.; SAB_SIZE];

#[no_mangle]
pub extern "C" fn safety_limiter_get_sab_buf_ptr() -> *const f32 { addr_of!(SAB) as *const _ }

fn sab() -> &'static mut [f32; SAB_SIZE] { unsafe { &mut *addr_of_mut!(SAB) } }

const LOOKAHEAD_SAMPLE_COUNT: usize = 40;

struct SafetyLimiterState {
  pub lookahead_buffer: [f32; LOOKAHEAD_SAMPLE_COUNT],
  pub envelope: f32,
}

impl SafetyLimiterState {
  pub const fn new() -> Self {
    Self {
      lookahead_buffer: [0.0; LOOKAHEAD_SAMPLE_COUNT],
      envelope: 0.0,
    }
  }
}

static mut STATE: SafetyLimiterState = SafetyLimiterState::new();

const ATTACK_COEFFICIENT: f32 = 0.08;

const RELEASE_COEFFICIENT: f32 = 0.003;

const THRESHOLD: f32 = 6.;
const RATIO: f32 = 200.;

fn io_buf() -> &'static mut [f32; dsp::FRAME_SIZE] { unsafe { &mut *addr_of_mut!(IO_BUFFER) } }

fn state() -> &'static mut SafetyLimiterState { unsafe { &mut *addr_of_mut!(STATE) } }

fn detect_level_peak_and_apply_envelope(envelope: &mut f32, lookahead_sample: f32) -> f32 {
  let abs_lookahead_sample = if lookahead_sample.is_normal() {
    lookahead_sample.abs()
  } else {
    0.
  };

  dsp::one_pole(
    envelope,
    abs_lookahead_sample,
    if abs_lookahead_sample > *envelope {
      ATTACK_COEFFICIENT
    } else {
      RELEASE_COEFFICIENT
    },
  )
}

fn compute_output_level_db(detected_level_db: f32) -> f32 {
  THRESHOLD + (detected_level_db - THRESHOLD) / RATIO
}

fn compute_gain_to_apply(detected_level_db: f32) -> f32 {
  let output_level_db = compute_output_level_db(detected_level_db);
  let db_to_reduce = detected_level_db - output_level_db;
  db_to_gain(-db_to_reduce)
}

fn process(envelope: &mut f32, sample: f32, lookahead_sample: f32) -> f32 {
  // some audio drivers behave badly when you send them `NaN` or `Infinity`...
  if !sample.is_normal() {
    return 0.;
  }

  // default to limiting with a very short attack and release
  let detected_level_linear = detect_level_peak_and_apply_envelope(envelope, lookahead_sample);
  let detected_level_db = dsp::gain_to_db(detected_level_linear);

  if detected_level_db < THRESHOLD {
    return sample;
  }

  let gain_to_apply = compute_gain_to_apply(detected_level_db);
  let sample = sample * gain_to_apply;

  // apply hard clipping as a last resort
  dsp::clamp(-4., 4., sample)
}

#[no_mangle]
pub extern "C" fn safety_limiter_get_io_buffer_ptr() -> *mut f32 { io_buf().as_mut_ptr() }

#[no_mangle]
pub extern "C" fn safety_limiter_process() {
  let state = state();
  let io_buf = io_buf();

  let input_samples: [f32; dsp::FRAME_SIZE - LOOKAHEAD_SAMPLE_COUNT] =
    std::array::from_fn(|i| io_buf[i]);

  for i in 0..LOOKAHEAD_SAMPLE_COUNT {
    let sample = state.lookahead_buffer[i];
    let lookahead_sample = io_buf[i];
    io_buf[i] = process(&mut state.envelope, sample, lookahead_sample);
  }

  state
    .lookahead_buffer
    .copy_from_slice(&io_buf[io_buf.len() - LOOKAHEAD_SAMPLE_COUNT..]);

  for i in 0..input_samples.len() {
    let sample = input_samples[i];
    let lookahead_sample: f32 = input_samples[i];
    let sample = process(&mut state.envelope, sample, lookahead_sample);
    io_buf[LOOKAHEAD_SAMPLE_COUNT + i] = sample;
  }

  let detected_level_linear = state.envelope;
  let detected_level_db = dsp::gain_to_db(detected_level_linear);
  let output_level_db = if detected_level_db > THRESHOLD {
    compute_output_level_db(detected_level_db)
  } else {
    detected_level_db
  };

  let sab = sab();
  sab[0] = detected_level_db;
  sab[1] = output_level_db;
  sab[2] = if detected_level_db < THRESHOLD {
    1.
  } else {
    compute_gain_to_apply(detected_level_db)
  };
}

#[test]
fn coefficients() {
  println!("100. to db: {}", dsp::gain_to_db(100.));
  println!("40. to db: {}", dsp::gain_to_db(40.));
  println!("8. to db: {}", dsp::gain_to_db(8.));
  println!("4. to db: {}", dsp::gain_to_db(4.));
  println!("2.5 to db: {}", dsp::gain_to_db(2.5));

  let mut envelope = 0.;
  let signal = vec![
    0., 0., 40., 40., 40., 40., 40., 40., 40., 40., 40., 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0.,
    0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0.,
  ];
  let mut applied = vec![0.; signal.len()];

  for i in 0..signal.len() {
    applied[i] = process(
      &mut envelope,
      signal[i],
      signal.get(i + 4).copied().unwrap_or(0.),
    );
  }

  println!("{applied:?}")
}

#[test]
fn lookback_correctness() {
  let mut data = Vec::new();
  for i in 0..dsp::FRAME_SIZE * 8 {
    data.push(0.0001 * i as f32);
  }

  let mut out = Vec::new();
  for frame in data.chunks_exact(dsp::FRAME_SIZE) {
    io_buf().copy_from_slice(frame);
    safety_limiter_process();
    println!("OUT: {:?}\n", io_buf());
    out.extend(io_buf().iter().copied());
  }

  for i in 0..LOOKAHEAD_SAMPLE_COUNT {
    assert_eq!(out[i], 0.);
  }

  for i in LOOKAHEAD_SAMPLE_COUNT..out.len() {
    let val = i - LOOKAHEAD_SAMPLE_COUNT;
    assert_eq!(out[i], val as f32 * 0.0001);
  }
}
