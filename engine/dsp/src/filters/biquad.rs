use std::f32::consts::PI;

use crate::{linear_to_db_checked, FRAME_SIZE, NYQUIST};

/// Second-order biquad filter
#[derive(Clone, Copy, Default)]
pub struct BiquadFilter {
  pub b0_over_a0: f32,
  pub b1_over_a0: f32,
  pub b2_over_a0: f32,
  pub a1_over_a0: f32,
  pub a2_over_a0: f32,
  pub x: [f32; 2],
  pub y: [f32; 2],
}

#[derive(Debug, Clone, Copy)]
pub enum FilterMode {
  Lowpass,
  Highpass,
  Bandpass,
  Notch,
  Peak,
  Lowshelf,
  Highshelf,
  Allpass,
}

impl FilterMode {
  pub fn needs_gain(&self) -> bool {
    match self {
      FilterMode::Lowpass => false,
      FilterMode::Highpass => false,
      FilterMode::Bandpass => false,
      FilterMode::Notch => false,
      FilterMode::Peak => true,
      FilterMode::Lowshelf => true,
      FilterMode::Highshelf => true,
      FilterMode::Allpass => false,
    }
  }

  pub fn needs_q(&self) -> bool {
    match self {
      FilterMode::Lowpass => true,
      FilterMode::Highpass => true,
      FilterMode::Bandpass => true,
      FilterMode::Notch => true,
      FilterMode::Peak => true,
      FilterMode::Lowshelf => false,
      FilterMode::Highshelf => false,
      FilterMode::Allpass => true,
    }
  }
}

impl BiquadFilter {
  #[inline]
  pub fn compute_coefficients(
    mode: FilterMode,
    mut q: f32,
    freq: f32,
    gain: f32,
  ) -> (f32, f32, f32, f32, f32) {
    // From: https://webaudio.github.io/web-audio-api/#filters-characteristics
    let computed_frequency = crate::clamp(10., 21_830., freq);
    let normalized_freq = computed_frequency / NYQUIST;
    let w0 = PI * normalized_freq;
    #[allow(non_snake_case)]
    let A = 10.0_f32.powf(gain / 40.);
    let w0_sin = w0.sin();

    // for bandpass, notch, allpass, and peak filters, Q is a linear value with a minimum of 0.0001
    // https://webaudio.github.io/web-audio-api/#dom-biquadfilternode-q
    if matches!(
      mode,
      FilterMode::Bandpass | FilterMode::Notch | FilterMode::Allpass | FilterMode::Peak
    ) {
      q = crate::clamp(0.0001, 1000., crate::db_to_gain(q));
    }

    let aq = w0_sin / (2. * q);
    let aqdb = w0_sin / (2. * 10.0f32.powf(q / 20.));
    #[allow(non_snake_case)]
    let S = 1.;
    let a_s = (w0_sin / 2.) * ((A + (1. / A)) * ((1. / S) - 1.) + 2.).sqrt();

    let (b0, b1, b2, a0, a1, a2);

    let w0_cos = w0.cos();
    match mode {
      FilterMode::Lowpass => {
        b0 = (1. - w0_cos) / 2.;
        b1 = 1. - w0_cos;
        b2 = (1. - w0_cos) / 2.;
        a0 = 1. + aqdb;
        a1 = -2. * w0_cos;
        a2 = 1. - aqdb;
      },
      FilterMode::Highpass => {
        b0 = (1. + w0_cos) / 2.;
        b1 = -(1. + w0_cos);
        b2 = (1. + w0_cos) / 2.;
        a0 = 1. + aqdb;
        a1 = -2. * w0_cos;
        a2 = 1. - aqdb;
      },
      FilterMode::Bandpass => {
        b0 = aq;
        b1 = 0.;
        b2 = -aq;
        a0 = 1. + aq;
        a1 = -2. * w0_cos;
        a2 = 1. - aq;
      },
      FilterMode::Notch => {
        b0 = 1.;
        b1 = -2. * w0_cos;
        b2 = 1.;
        a0 = 1. + aq;
        a1 = -2. * w0_cos;
        a2 = 1. - aq;
      },
      FilterMode::Peak => {
        b0 = 1. + aq * A;
        b1 = -2. * w0_cos;
        b2 = 1. - aq * A;
        a0 = 1. + aq / A;
        a1 = -2. * w0_cos;
        a2 = 1. - aq / A;
      },
      FilterMode::Lowshelf => {
        #[allow(non_snake_case)]
        let A_sqrt = A.sqrt();
        b0 = A * ((A + 1.) - (A - 1.) * w0_cos + 2. * a_s * A_sqrt);
        b1 = 2. * A * ((A - 1.) - (A + 1.) * w0_cos);
        b2 = A * ((A + 1.) - (A - 1.) * w0_cos - 2. * a_s * A_sqrt);
        a0 = (A + 1.) + (A - 1.) * w0_cos + 2. * a_s * A_sqrt;
        a1 = -2. * ((A - 1.) + (A + 1.) * w0_cos);
        a2 = (A + 1.) + (A - 1.) * w0_cos - 2. * a_s * A_sqrt;
      },
      FilterMode::Highshelf => {
        #[allow(non_snake_case)]
        let A_sqrt = A.sqrt();
        b0 = A * ((A + 1.) + (A - 1.) * w0_cos + 2. * a_s * A_sqrt);
        b1 = -2. * A * ((A - 1.) + (A + 1.) * w0_cos);
        b2 = A * ((A + 1.) + (A - 1.) * w0_cos - 2. * a_s * A_sqrt);
        a0 = (A + 1.) - (A - 1.) * w0_cos + 2. * a_s * A_sqrt;
        a1 = 2. * ((A - 1.) - (A + 1.) * w0_cos);
        a2 = (A + 1.) - (A - 1.) * w0_cos - 2. * a_s * A_sqrt;
      },
      FilterMode::Allpass => {
        b0 = 1. - aq;
        b1 = -2. * w0_cos;
        b2 = 1. + aq;
        a0 = 1. + aq;
        a1 = -2. * w0_cos;
        a2 = 1. - aq;
      },
    }

    (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
  }

  #[inline]
  pub fn set_coefficients(&mut self, mode: FilterMode, q: f32, freq: f32, gain: f32) {
    let (b0_over_a0, b1_over_a0, b2_over_a0, a1_over_a0, a2_over_a0) =
      Self::compute_coefficients(mode, q, freq, gain);

    self.b0_over_a0 = b0_over_a0;
    self.b1_over_a0 = b1_over_a0;
    self.b2_over_a0 = b2_over_a0;
    self.a1_over_a0 = a1_over_a0;
    self.a2_over_a0 = a2_over_a0;
  }

  #[inline]
  pub fn new(mode: FilterMode, q: f32, freq: f32, gain: f32) -> BiquadFilter {
    let mut filter = BiquadFilter::default();
    filter.set_coefficients(mode, q, freq, gain);
    filter
  }

  /// Called when a voice is gated.  Resets internal filter states to make it like the filter has
  /// been fed silence for an infinite amount of time.
  #[inline]
  pub fn reset(&mut self) {
    self.x = [0.; 2];
    self.y = [0.; 2];
  }

  #[inline]
  pub fn apply(&mut self, input: f32) -> f32 {
    let output =
      self.b0_over_a0 * input + self.b1_over_a0 * self.x[0] + self.b2_over_a0 * self.x[1]
        - self.a1_over_a0 * self.y[0]
        - self.a2_over_a0 * self.y[1];

    self.x = [input, self.x[0]];
    self.y = [output, self.y[0]];

    output
  }

  #[inline]
  pub fn apply_with_coefficients(
    &mut self,
    input: f32,
    b0_over_a0: f32,
    b1_over_a0: f32,
    b2_over_a0: f32,
    a1_over_a0: f32,
    a2_over_a0: f32,
  ) -> f32 {
    let output = b0_over_a0 * input + b1_over_a0 * self.x[0] + b2_over_a0 * self.x[1]
      - a1_over_a0 * self.y[0]
      - a2_over_a0 * self.y[1];

    self.x = [input, self.x[0]];
    self.y = [output, self.y[0]];

    output
  }

  #[inline]
  pub fn compute_coefficients_and_apply(
    &mut self,
    mode: FilterMode,
    q: f32,
    freq: f32,
    gain: f32,
    input: f32,
  ) -> f32 {
    let (b0_over_a0, b1_over_a0, b2_over_a0, a1_over_a0, a2_over_a0) =
      Self::compute_coefficients(mode, q, freq, gain);

    self.apply_with_coefficients(
      input, b0_over_a0, b1_over_a0, b2_over_a0, a1_over_a0, a2_over_a0,
    )
  }

  #[inline]
  pub fn compute_coefficients_and_apply_frame(
    &mut self,
    mode: FilterMode,
    base_q: f32,
    qs: &[f32; FRAME_SIZE],
    freqs: &[f32; FRAME_SIZE],
    gains: &[f32; FRAME_SIZE],
    frame: &mut [f32; FRAME_SIZE],
  ) {
    let mut x = self.x;
    let mut y = self.y;

    for i in 0..FRAME_SIZE {
      let freq = freqs[i];
      let gain = gains[i];
      let q = base_q + qs[i];
      let (b0_over_a0, b1_over_a0, b2_over_a0, a1_over_a0, a2_over_a0) =
        Self::compute_coefficients(mode, q, freq, gain);

      let input = frame[i];
      let output = b0_over_a0 * input + b1_over_a0 * x[0] + b2_over_a0 * x[1]
        - a1_over_a0 * y[0]
        - a2_over_a0 * y[1];
      frame[i] = output;

      x = [input, x[0]];
      y = [output, y[0]];
    }

    self.x = x;
    self.y = y;
  }

  #[inline]
  pub fn compute_coefficients_and_apply_frame_minimal(
    &mut self,
    mode: FilterMode,
    cutoff_freq: &[f32; FRAME_SIZE],
    q: f32,
    frame: &mut [f32; FRAME_SIZE],
  ) {
    let mut x = self.x;
    let mut y = self.y;

    for i in 0..FRAME_SIZE {
      let freq = cutoff_freq[i];
      let (b0_over_a0, b1_over_a0, b2_over_a0, a1_over_a0, a2_over_a0) =
        Self::compute_coefficients(mode, q, freq, 0.);

      let input = frame[i];
      let output = b0_over_a0 * input + b1_over_a0 * x[0] + b2_over_a0 * x[1]
        - a1_over_a0 * y[0]
        - a2_over_a0 * y[1];
      frame[i] = output;

      x = [input, x[0]];
      y = [output, y[0]];
    }

    self.x = x;
    self.y = y;
  }

  #[inline]
  pub fn compute_coefficients_and_apply_frame_static_q(
    &mut self,
    mode: FilterMode,
    q: f32,
    freqs: &[f32; FRAME_SIZE],
    gains: &[f32; FRAME_SIZE],
    frame: &mut [f32; FRAME_SIZE],
  ) {
    let mut x = self.x;
    let mut y = self.y;

    for i in 0..FRAME_SIZE {
      let freq = freqs[i];
      let gain = gains[i];
      let (b0_over_a0, b1_over_a0, b2_over_a0, a1_over_a0, a2_over_a0) =
        Self::compute_coefficients(mode, q, freq, gain);

      let input = frame[i];
      let output = b0_over_a0 * input + b1_over_a0 * x[0] + b2_over_a0 * x[1]
        - a1_over_a0 * y[0]
        - a2_over_a0 * y[1];
      frame[i] = output;

      x = [input, x[0]];
      y = [output, y[0]];
    }

    self.x = x;
    self.y = y;
  }
}

/// Coefficients and state are stored as SoA.  Since applying biquad filter chains has a serial
/// dependency on the previous output, we apply banks in parallel and store coefficients and state
/// as bank[0][0], bank[1][0], ... bank[1][0], bank[1][1], ...
pub struct BiquadFilterBank2D<const BANK_COUNT: usize, const BANK_LENGTH: usize> {
  pub b0_over_a0: [[f32; BANK_COUNT]; BANK_LENGTH],
  pub b1_over_a0: [[f32; BANK_COUNT]; BANK_LENGTH],
  pub b2_over_a0: [[f32; BANK_COUNT]; BANK_LENGTH],
  pub a1_over_a0: [[f32; BANK_COUNT]; BANK_LENGTH],
  pub a2_over_a0: [[f32; BANK_COUNT]; BANK_LENGTH],
  pub x0: [[f32; BANK_COUNT]; BANK_LENGTH],
  pub x1: [[f32; BANK_COUNT]; BANK_LENGTH],
  pub y0: [[f32; BANK_COUNT]; BANK_LENGTH],
  pub y1: [[f32; BANK_COUNT]; BANK_LENGTH],
}

impl<const BANK_COUNT: usize, const BANK_LENGTH: usize>
  BiquadFilterBank2D<BANK_COUNT, BANK_LENGTH>
{
  #[cold]
  pub fn new(
    filters: &[[BiquadFilter; BANK_COUNT]; BANK_LENGTH],
  ) -> BiquadFilterBank2D<BANK_COUNT, BANK_LENGTH> {
    let mut b0_over_a0 = [[0.; BANK_COUNT]; BANK_LENGTH];
    let mut b1_over_a0 = [[0.; BANK_COUNT]; BANK_LENGTH];
    let mut b2_over_a0 = [[0.; BANK_COUNT]; BANK_LENGTH];
    let mut a1_over_a0 = [[0.; BANK_COUNT]; BANK_LENGTH];
    let mut a2_over_a0 = [[0.; BANK_COUNT]; BANK_LENGTH];
    let mut x0 = [[0.; BANK_COUNT]; BANK_LENGTH];
    let mut x1 = [[0.; BANK_COUNT]; BANK_LENGTH];
    let mut y0 = [[0.; BANK_COUNT]; BANK_LENGTH];
    let mut y1 = [[0.; BANK_COUNT]; BANK_LENGTH];

    for bank_ix in 0..BANK_COUNT {
      for filter_ix in 0..BANK_LENGTH {
        b0_over_a0[filter_ix][bank_ix] = filters[filter_ix][bank_ix].b0_over_a0;
        b1_over_a0[filter_ix][bank_ix] = filters[filter_ix][bank_ix].b1_over_a0;
        b2_over_a0[filter_ix][bank_ix] = filters[filter_ix][bank_ix].b2_over_a0;
        a1_over_a0[filter_ix][bank_ix] = filters[filter_ix][bank_ix].a1_over_a0;
        a2_over_a0[filter_ix][bank_ix] = filters[filter_ix][bank_ix].a2_over_a0;
        x0[filter_ix][bank_ix] = filters[filter_ix][bank_ix].x[0];
        x1[filter_ix][bank_ix] = filters[filter_ix][bank_ix].x[1];
        y0[filter_ix][bank_ix] = filters[filter_ix][bank_ix].y[0];
        y1[filter_ix][bank_ix] = filters[filter_ix][bank_ix].y[1];
      }
    }

    BiquadFilterBank2D {
      b0_over_a0,
      b1_over_a0,
      b2_over_a0,
      a1_over_a0,
      a2_over_a0,
      x0,
      x1,
      y0,
      y1,
    }
  }

  #[cfg(target_arch = "wasm32")]
  #[inline]
  pub fn apply_simd(&mut self, output: &mut [f32; BANK_COUNT], depth: usize) {
    use std::arch::wasm32::*;
    let output_ptr = output.as_mut_ptr();

    const CHUNK_SIZE: usize = 4;
    let chunk_count: usize = BANK_COUNT / CHUNK_SIZE;
    let remainder: usize = BANK_COUNT % CHUNK_SIZE;

    // for depth in 0..BANK_COUNT {
    for chunk_ix in 0..chunk_count {
      let base_band_ix = chunk_ix * CHUNK_SIZE;

      let b0_over_a0 =
        unsafe { v128_load(&self.b0_over_a0[depth][base_band_ix] as *const _ as *const v128) };
      let b1_over_a0 =
        unsafe { v128_load(&self.b1_over_a0[depth][base_band_ix] as *const _ as *const v128) };
      let b2_over_a0 =
        unsafe { v128_load(&self.b2_over_a0[depth][base_band_ix] as *const _ as *const v128) };
      let a1_over_a0 =
        unsafe { v128_load(&self.a1_over_a0[depth][base_band_ix] as *const _ as *const v128) };
      let a2_over_a0 =
        unsafe { v128_load(&self.a2_over_a0[depth][base_band_ix] as *const _ as *const v128) };
      let x0 = unsafe { v128_load(&self.x0[depth][base_band_ix] as *const _ as *const v128) };
      let x1 = unsafe { v128_load(&self.x1[depth][base_band_ix] as *const _ as *const v128) };
      let y0 = unsafe { v128_load(&self.y0[depth][base_band_ix] as *const _ as *const v128) };
      let y1 = unsafe { v128_load(&self.y1[depth][base_band_ix] as *const _ as *const v128) };

      let ins = unsafe { v128_load(output_ptr.add(base_band_ix) as *const v128) };

      // let output =
      //   self.b0_over_a0 * input + self.b1_over_a0 * self.x[0] + self.b2_over_a0 * self.x[1]
      //     - self.a1_over_a0 * self.y[0]
      //     - self.a2_over_a0 * self.y[1];
      let outs = f32x4_mul(b0_over_a0, ins);
      let outs = f32x4_add(outs, f32x4_mul(b1_over_a0, x0));
      let outs = f32x4_add(outs, f32x4_mul(b2_over_a0, x1));
      let outs = f32x4_sub(outs, f32x4_mul(a1_over_a0, y0));
      let outs = f32x4_sub(outs, f32x4_mul(a2_over_a0, y1));

      unsafe {
        v128_store(&self.x0[depth][base_band_ix] as *const _ as *mut v128, ins);
        v128_store(&self.x1[depth][base_band_ix] as *const _ as *mut v128, x0);
        v128_store(&self.y0[depth][base_band_ix] as *const _ as *mut v128, outs);
        v128_store(&self.y1[depth][base_band_ix] as *const _ as *mut v128, y0);

        v128_store(output_ptr.add(base_band_ix) as *mut v128, outs);
      }
    }

    for band_ix in chunk_count * CHUNK_SIZE..chunk_count * CHUNK_SIZE + remainder {
      let b0_over_a0 = self.b0_over_a0[depth][band_ix];
      let b1_over_a0 = self.b1_over_a0[depth][band_ix];
      let b2_over_a0 = self.b2_over_a0[depth][band_ix];
      let a1_over_a0 = self.a1_over_a0[depth][band_ix];
      let a2_over_a0 = self.a2_over_a0[depth][band_ix];
      let x0 = self.x0[depth][band_ix];
      let x1 = self.x1[depth][band_ix];
      let y0 = self.y0[depth][band_ix];
      let y1 = self.y1[depth][band_ix];

      let ins = output[band_ix];

      let outs =
        b0_over_a0 * ins + b1_over_a0 * x0 + b2_over_a0 * x1 - a1_over_a0 * y0 - a2_over_a0 * y1;

      self.x0[depth][band_ix] = ins;
      self.x1[depth][band_ix] = x0;
      self.y0[depth][band_ix] = outs;
      self.y1[depth][band_ix] = y0;

      output[band_ix] = outs;
    }
  }
}

/// higher-order filter Q factors determined using this: https://www.earlevel.com/main/2016/09/29/cascading-filters/
#[inline]
pub fn compute_higher_order_biquad_q_factors(order: usize) -> Vec<f32> {
  if order % 2 != 0 || order <= 0 {
    panic!("order must be even and greater than 0");
  }

  (0..order / 2)
    .map(|i| {
      linear_to_db_checked(
        1. / (2. * (PI / order as f32 / 2. + (PI / order as f32) * i as f32).cos()),
      )
    })
    .collect()
}

#[cfg(target_arch = "wasm32")]
pub extern "C" fn apply(
  banks: &mut BiquadFilterBank2D<22, 16>,
  outputs: &mut [f32; 22],
  inputs: &[f32; 128],
) {
  outputs.fill(inputs[0]);
  for depth in 0..22 {
    banks.apply_simd(outputs, depth);
  }
}
