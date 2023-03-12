use std::f32::consts::PI;

use rustfft::{num_complex::Complex32, FftPlanner};

use self::helpers::plot_wave;

mod helpers;

fn hypotf(x: f32, y: f32) -> f32 { (x * x + y * y).sqrt() }

fn complex_from_magnitude_and_phase(magnitude: f32, phase: f32) -> Complex32 {
  Complex32 {
    re: magnitude * phase.cos(),
    im: -magnitude * phase.sin(),
  }
}

fn magnitude_from_complex(c: Complex32) -> f32 { hypotf(c.re, c.im) }

fn phase_from_complex(c: Complex32) -> f32 { c.im.atan2(c.re) }

#[test]
fn complex_correctness() {
  let a = complex_from_magnitude_and_phase(1., 0.);
  let a_mag = magnitude_from_complex(a);
  assert_eq!(a_mag, 1.);

  let a = complex_from_magnitude_and_phase(1., NINETY_DEGREES);
  let a_mag = magnitude_from_complex(a);
  assert_eq!(a_mag, 1.);

  let a = complex_from_magnitude_and_phase(2., 2. * NINETY_DEGREES);
  let a_mag = magnitude_from_complex(a);
  assert_eq!(a_mag, 2.);
}

#[test]
fn basic_sine_synthesis() {
  let planner = FftPlanner::new().plan_fft_inverse(1024);
  let mut buffer = vec![Complex32 { im: 0., re: 0. }; 1024];
  buffer[1].re = 0.;
  buffer[1].im = -1.;
  planner.process(&mut buffer);

  let reals = buffer.iter().map(|c| c.re).collect::<Vec<_>>();
  plot_wave(&reals);
}

fn normalize(vals: &mut [Complex32]) {
  let max = vals
    .iter()
    .map(|v| v.re.abs())
    .fold(0.0f32, |a, b| a.max(b));
  for v in vals {
    v.re /= max;
  }
}

#[test]
fn basic_sawtooth_synthesis() {
  let planner = FftPlanner::new().plan_fft_inverse(1024);
  let mut buffer = vec![Complex32 { im: 0., re: 0. }; 1024];
  for i in 1..1024 {
    buffer[i].im = -(1. / (i as f32));
  }
  planner.process(&mut buffer);
  normalize(&mut buffer);

  let reals = buffer.iter().map(|c| c.re).collect::<Vec<_>>();
  plot_wave(&reals);

  // let imags = buffer.iter().map(|c| c.im / PI).collect::<Vec<_>>();
  // plot_wave(&imags);
}

const NINETY_DEGREES: f32 = std::f32::consts::PI / 2.;

#[test]
fn phase_shifted_sawtooth_synthesis() {
  let planner = FftPlanner::new().plan_fft_inverse(1024);
  let mut buffer = vec![Complex32 { im: 0., re: 0. }; 1024];
  for i in 1..1024 {
    let mag = 1. / (i as f32);
    let phase = -NINETY_DEGREES;
    buffer[i] = complex_from_magnitude_and_phase(mag, phase);
  }

  // We want to shift the entire waveform in the time domain by 0.2 rads

  for (i, v) in buffer.iter_mut().enumerate() {
    if i == 0 {
      *v = complex_from_magnitude_and_phase(0., PI);
      continue;
    }

    let phase = -NINETY_DEGREES + PI;
    let mag = magnitude_from_complex(*v);
    *v = complex_from_magnitude_and_phase(mag, phase);
  }

  planner.process(&mut buffer);
  // normalize(&mut buffer);

  let reals = buffer.iter().map(|c| c.re).collect::<Vec<_>>();
  plot_wave(&reals);
}

#[test]
fn basic_square_wave() {
  let planner = FftPlanner::new().plan_fft_inverse(1024);
  let mut buffer = vec![Complex32 { im: 0., re: 0. }; 1024];
  buffer[1].im = -1.;
  for i in 3..1024 {
    if i % 2 == 1 {
      buffer[i].im = -(1. / (i as f32));
    }
  }
  planner.process(&mut buffer);
  normalize(&mut buffer);

  let reals = buffer.iter().map(|c| c.re).collect::<Vec<_>>();
  plot_wave(&reals);
}

#[test]
fn basic_square_wave_forward() {
  let planner = FftPlanner::new().plan_fft_forward(1024);
  let mut buffer = vec![Complex32 { im: 0., re: -1. }; 1024];

  // unshifted
  for i in 0..512 {
    buffer[i].re = 1.;
  }

  planner.process(&mut buffer);

  let phases = buffer
    .iter()
    .map(|c| phase_from_complex(*c) / PI)
    .collect::<Vec<_>>();
  plot_wave(&phases[..20]);

  // shifted
  drop(buffer);
  let mut buffer = vec![Complex32 { im: 0., re: -1. }; 1024];
  for i in 256..768 {
    buffer[i].re = 1.;
  }

  planner.process(&mut buffer);

  let phases = buffer
    .iter()
    .map(|c| phase_from_complex(*c) / PI)
    .collect::<Vec<_>>();
  plot_wave(&phases[..20]);

  // shifted
  drop(buffer);
  let mut buffer = vec![Complex32 { im: 0., re: -1. }; 1024];
  for i in 512..1024 {
    buffer[i].re = 1.;
  }

  planner.process(&mut buffer);

  let phases = buffer
    .iter()
    .map(|c| phase_from_complex(*c) / PI)
    .collect::<Vec<_>>();
  plot_wave(&phases[..20]);
}

/// Given the frequency domain representation of a waveform, alters the phases of the components to
/// shift the waveform by `wavelengths` of the fundamental frequency.
fn shift_waveform(buffer: &mut [Complex32], wavelengths: f32) {
  for (i, v) in buffer[24..].iter_mut().enumerate() {
    if i == 0 {
      *v = complex_from_magnitude_and_phase(0., PI);
      continue;
    }

    *v *= complex_from_magnitude_and_phase(1., -wavelengths * PI * 2. * i as f32);
  }
}

#[test]
fn square_wave_shift() {
  let planner = FftPlanner::new().plan_fft_inverse(1024);
  let mut buffer = vec![Complex32 { im: 0., re: 0. }; 1024];
  for i in 1..1024 {
    if i % 2 == 1 {
      buffer[i].im = -(1. / (i as f32));
    }
  }

  shift_waveform(&mut buffer, 0.25);

  planner.process(&mut buffer);

  let reals = buffer.iter().map(|c| c.re).collect::<Vec<_>>();
  plot_wave(&reals);
}

#[test]
fn basic_sine_forward() {
  let planner = FftPlanner::new().plan_fft_forward(1024);
  let mut buffer = vec![Complex32 { im: 0., re: 0. }; 1024];
  for i in 0..buffer.len() {
    for harmonic_ix in 1..10 {
      let shift_local_wavelengths = 0. * harmonic_ix as f32;
      let phase = (i as f32 / buffer.len() as f32) * PI * 2. * harmonic_ix as f32
        + -shift_local_wavelengths * PI * 2.;
      buffer[i].re += phase.sin();
    }
  }

  let samples = buffer.iter().map(|c| c.re).collect::<Vec<_>>();
  plot_wave(&samples[..]);

  planner.process(&mut buffer);

  let mags = buffer
    .iter()
    .map(|c| magnitude_from_complex(*c))
    .collect::<Vec<_>>();
  plot_wave(&mags[..3]);

  let phases = buffer
    .iter()
    .map(|c| phase_from_complex(*c) / PI)
    .collect::<Vec<_>>();
  plot_wave(&phases[..3]);

  println!("----SHIFTED----");

  let shift_base_wavelengths = 0.125;
  // First 10 harmonics all at the same level shifted forward by `shift_wavelengths`
  let mut buffer = vec![Complex32 { im: 0., re: 0. }; 1024];
  for i in 0..buffer.len() {
    for harmonic_ix in 1..10 {
      let shift_local_wavelengths = shift_base_wavelengths * harmonic_ix as f32;
      let phase = (i as f32 / buffer.len() as f32) * PI * 2. * harmonic_ix as f32
        + -shift_local_wavelengths * PI * 2.;
      buffer[i].re += phase.sin();
    }
  }

  let samples = buffer.iter().map(|c| c.re).collect::<Vec<_>>();
  plot_wave(&samples[..]);

  planner.process(&mut buffer);

  let mags = buffer
    .iter()
    .map(|c| magnitude_from_complex(*c))
    .collect::<Vec<_>>();
  plot_wave(&mags[..6]);

  let phases = buffer
    .iter()
    .map(|c| phase_from_complex(*c) / PI)
    .collect::<Vec<_>>();
  plot_wave(&phases[..6]);
  println!("{:?}", &phases[0..6]);
}
