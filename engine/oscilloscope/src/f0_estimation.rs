//! Fundamental frequency estimation

use std::io::Write;

use crate::{
  conf::{SAMPLE_RATE, YIN_FRAME_SIZE, YIN_MAX_PERIOD, YIN_THRESHOLD},
  FRAME_SIZE,
};

/// YIN pitch detection algorithm.  Estimates fundamental frequency of a signal in Hz.
pub(crate) fn yin<const YIN_FRAME_SIZE: usize, const MAX_PERIOD: usize>(
  samples: &[f32; YIN_FRAME_SIZE],
) -> f32 {
  assert!(YIN_FRAME_SIZE >= MAX_PERIOD * 2);

  let tau: usize;
  let mut delta = [0.0_f32; MAX_PERIOD];
  let mut running_sum = 0.0;

  for tau in 1..MAX_PERIOD {
    for i in 0..(MAX_PERIOD - 1) {
      let diff = samples[i] - samples[i + tau];
      delta[tau] += diff * diff;
    }

    running_sum += delta[tau];
    if running_sum != 0.0 {
      delta[tau] *= tau as f32 / running_sum;
    } else {
      delta[tau] = 1.0;
    }
  }

  tau = 1
    + delta[1..]
      .iter()
      .enumerate()
      .find(|(_, &value)| value < YIN_THRESHOLD)
      .map(|(i, _)| i)
      .unwrap_or(
        delta[1..]
          .iter()
          .enumerate()
          .min_by(|(_, &a), (_, &b)| a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal))
          .unwrap()
          .0,
      );

  SAMPLE_RATE / tau as f32
}

pub(crate) struct YinCtx {
  /// Rolling estimate of the F0 using light smoothing in between frames
  pub rolling_f0_estimate: f32,
  /// The locked F0 estimate from the current window
  pub cur_f0_estimate: f32,
  pub samples_buf: [f32; YIN_FRAME_SIZE],
  pub buf_head: usize,
  pub f0_display: [u8; 64],
}

impl YinCtx {
  pub(crate) const fn new() -> Self {
    Self {
      buf_head: 0,
      cur_f0_estimate: 100.,
      rolling_f0_estimate: 100.,
      samples_buf: [0.0; YIN_FRAME_SIZE],
      f0_display: [0; 64],
    }
  }

  pub(crate) fn process_frame(&mut self, samples: &[f32; FRAME_SIZE]) {
    // Copy the new samples into the circular buffer
    self.samples_buf[self.buf_head..self.buf_head + FRAME_SIZE].copy_from_slice(samples);
    self.buf_head += FRAME_SIZE;

    if self.buf_head != YIN_FRAME_SIZE {
      return;
    }
    self.buf_head = 0;

    // Estimate the F0 of the current frame
    let f0 = yin::<YIN_FRAME_SIZE, YIN_MAX_PERIOD>(&self.samples_buf);
    // There seems to be a bias in the YIN algorithm, and this kind of corrects it a bit
    let f0 = f0 * 0.998;

    // Update the rolling F0 estimate
    dsp::smooth(&mut self.rolling_f0_estimate, f0, 0.3);
  }

  pub(crate) fn get_detected_f0_display(&mut self) -> *const u8 {
    // re-use allocation if possible
    if self.rolling_f0_estimate > SAMPLE_RATE / 2. {
      return b"---\0".as_ptr();
    }
    write!(
      &mut self.f0_display as &mut [u8],
      "{:.2}Hz; {}\0",
      self.rolling_f0_estimate,
      freq_to_midi_note_name(self.rolling_f0_estimate)
    )
    .unwrap();
    self.f0_display.as_ptr()
  }
}

pub(crate) fn freq_to_midi_note_name(frequency: f32) -> String {
  let note_number = 12.0 * ((frequency / 440.0).ln() / (2.0_f32).ln()) + 69.0;
  let note_name = match (note_number as i32) % 12 {
    0 => "C",
    1 => "C#",
    2 => "D",
    3 => "D#",
    4 => "E",
    5 => "F",
    6 => "F#",
    7 => "G",
    8 => "G#",
    9 => "A",
    10 => "A#",
    11 => "B",
    _ => unreachable!(),
  };
  let octave = ((note_number as i32) / 12) - 1;
  format!("{}{}", note_name, octave)
}

#[test]
fn test_yin() {
  const YIN_FRAME_SIZE: usize = FRAME_SIZE * 16;
  const MAX_PERIOD: usize = 44_100 / 80;

  fn snap_to_midi_pitch(f0: f32) -> f32 {
    let mut midi_pitch = 12. * (f0 / 440.).log2();
    midi_pitch = midi_pitch.round();
    440. * 2_f32.powf(midi_pitch / 12.)
  }

  // 1500 Hz sine wave + 100 Hz sine wave
  let p1 = snap_to_midi_pitch(1500.);
  let p2 = snap_to_midi_pitch(100.);
  dbg!(p1, p2);
  let mut samples = [0.; YIN_FRAME_SIZE];
  for i in 0..YIN_FRAME_SIZE {
    samples[i] += (i as f32 * 2. * std::f32::consts::PI * p1 / SAMPLE_RATE as f32).sin() * 0.2;
    samples[i] += (i as f32 * 2. * std::f32::consts::PI * p2 / SAMPLE_RATE as f32).sin() * 0.9;
  }

  let estimated_f0 = yin::<YIN_FRAME_SIZE, MAX_PERIOD>(&samples);
  println!("{}", estimated_f0);
  assert_eq!(snap_to_midi_pitch(estimated_f0), p2);

  let mut samples = [0.; YIN_FRAME_SIZE];
  for i in 0..YIN_FRAME_SIZE {
    samples[i] += (i as f32 * 2. * std::f32::consts::PI * p1 / SAMPLE_RATE as f32).sin() * 0.9;
    samples[i] += (i as f32 * 2. * std::f32::consts::PI * p2 / SAMPLE_RATE as f32).sin() * 0.2;
  }

  let estimated_f0 = yin::<YIN_FRAME_SIZE, MAX_PERIOD>(&samples);
  println!("{}", estimated_f0);
  assert_eq!(snap_to_midi_pitch(estimated_f0), p1);
}
