use std::ptr::addr_of_mut;

use dsp::db_to_gain;

static mut IO_BUFFER: [f32; dsp::FRAME_SIZE] = [0.0; dsp::FRAME_SIZE];

const LOOKAHEAD_SAMPLE_COUNT: usize = 4;

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

const ATTACK_COEFFICIENT: f32 = 0.3;

const RELEASE_COEFFICIENT: f32 = 0.05;

const THRESHOLD: f32 = 10.;
const RATIO: f32 = 40.;

fn io_buf() -> &'static mut [f32; dsp::FRAME_SIZE] { unsafe { &mut *addr_of_mut!(IO_BUFFER) } }

fn state() -> &'static mut SafetyLimiterState { unsafe { &mut *addr_of_mut!(STATE) } }

fn detect_level_peakand_apply_envelope(envelope: &mut f32, sample: f32) -> f32 {
  let abs_sample = sample.abs();
  println!("abs_sample={abs_sample}, envelope={envelope}");
  dsp::one_pole(
    envelope,
    abs_sample,
    if abs_sample > *envelope {
      ATTACK_COEFFICIENT
    } else {
      RELEASE_COEFFICIENT
    },
  )
}

fn compute_gain_to_apply(detected_level_db: f32) -> f32 {
  let target_level_db = THRESHOLD + (detected_level_db - THRESHOLD) / RATIO;
  let db_to_reduce = detected_level_db - target_level_db;
  db_to_gain(-db_to_reduce)
}

fn process(envelope: &mut f32, sample: f32) -> f32 {
  // some audio drivers behave badly when you send them `NaN` or `Infinity`...
  if !sample.is_normal() {
    return 0.;
  }

  // default to limiting with a very short attack and release
  let detected_level_linear = detect_level_peakand_apply_envelope(envelope, sample);
  dbg!(detected_level_linear);
  let detected_level_db = dsp::gain_to_db(detected_level_linear);

  if detected_level_db < THRESHOLD {
    return sample;
  }

  let gain_to_apply = compute_gain_to_apply(detected_level_db);
  println!("sample={sample}, gain_to_apply={gain_to_apply}");
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

  for &sample in &state.lookahead_buffer {
    process(&mut state.envelope, sample);
  }

  for &sample in &io_buf[..LOOKAHEAD_SAMPLE_COUNT] {
    process(&mut state.envelope, sample);
  }

  state
    .lookahead_buffer
    .copy_from_slice(&io_buf[io_buf.len() - LOOKAHEAD_SAMPLE_COUNT..]);
}

#[test]
fn coefficients() {
  println!("100. to db: {}", dsp::gain_to_db(100.));

  let mut envelope = 0.;
  let signal = vec![
    0., 0., 40., 40., 40., 40., 40., 40., 40., 40., 40., 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
  ];
  let mut applied = vec![0.; signal.len()];

  for i in 0..signal.len() {
    applied[i] = process(&mut envelope, signal[i]);
  }

  println!("{applied:?}")
}
