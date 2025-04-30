use std::{
  f32::consts::PI,
  ops::{AddAssign, MulAssign},
};

use num_complex::Complex;
use num_traits::{Float, FloatConst};

use crate::{db_to_gain_generic, linear_to_db_checked, FRAME_SIZE, NYQUIST};

/// Second-order biquad filter
#[derive(Clone, Copy, Default)]
pub struct BiquadFilter<T: Float + FloatConst + Default = f32> {
  pub b0_over_a0: T,
  pub b1_over_a0: T,
  pub b2_over_a0: T,
  pub a1_over_a0: T,
  pub a2_over_a0: T,
  pub x: [T; 2],
  pub y: [T; 2],
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

impl Default for FilterMode {
  fn default() -> Self { FilterMode::Lowpass }
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

  pub fn from_int(val: usize) -> Self {
    match val {
      0 => Self::Lowpass,
      1 => Self::Highpass,
      2 => Self::Bandpass,
      3 => Self::Notch,
      4 => Self::Peak,
      5 => Self::Lowshelf,
      6 => Self::Highshelf,
      7 => Self::Allpass,
      _ => panic!("Invalid filter mode: {val}"),
    }
  }
}

pub struct ComputeGridFilterParams<T: Float + FloatConst + Default> {
  pub q: T,
  pub cutoff_freq: T,
  pub gain: T,
}

impl<T: Float + FloatConst + Default + MulAssign + AddAssign> BiquadFilter<T> {
  #[inline]
  pub fn compute_coefficients(mode: FilterMode, mut q: T, freq: T, gain: T) -> (T, T, T, T, T) {
    // From: https://webaudio.github.io/web-audio-api/#filters-characteristics
    let computed_frequency =
      crate::clamp::<T>(T::from(10.).unwrap(), T::from(21_830.).unwrap(), freq);
    let normalized_freq = computed_frequency / T::from(NYQUIST).unwrap();
    let w0 = T::PI() * normalized_freq;
    #[allow(non_snake_case)]
    let A = T::powf(
      T::from(10.0_f64).unwrap(),
      gain / T::from(40.0_f64).unwrap(),
    );
    let w0_sin = w0.sin();

    // For lowpass and highpass filters the Q value is interpreted to be in dB.
    //
    // For the bandpass, notch, allpass, and peaking filters, Q is a linear value. The value is
    // related to the bandwidth of the filter and hence should be a positive value.
    //
    // https://webaudio.github.io/web-audio-api/#dom-biquadfilternode-q
    if matches!(
      mode,
      FilterMode::Bandpass | FilterMode::Notch | FilterMode::Allpass | FilterMode::Peak
    ) {
      q = crate::clamp(
        T::from(0.0001).unwrap(),
        T::from(1000.).unwrap(),
        crate::db_to_gain_generic(q),
      );
    }

    let aq = w0_sin / (T::from(2.).unwrap() * q);
    let aqdb =
      w0_sin / (T::from(2.).unwrap() * T::powf(T::from(10.).unwrap(), q / T::from(20.).unwrap()));
    #[allow(non_snake_case)]
    let S = T::one();
    let a_s = (w0_sin / T::from(2.).unwrap())
      * ((A + T::one() / A) * ((T::one() / S) - T::one()) + T::from(2.).unwrap()).sqrt();

    let (b0, b1, b2, a0, a1, a2);

    let w0_cos = w0.cos();
    match mode {
      FilterMode::Lowpass => {
        b0 = (T::one() - w0_cos) / T::from(2.).unwrap();
        b1 = T::one() - w0_cos;
        b2 = (T::one() - w0_cos) / T::from(2.).unwrap();
        a0 = T::one() + aqdb;
        a1 = T::from(-2.).unwrap() * w0_cos;
        a2 = T::one() - aqdb;
      },
      FilterMode::Highpass => {
        b0 = (T::one() + w0_cos) / T::from(2.).unwrap();
        b1 = -(T::one() + w0_cos);
        b2 = (T::one() + w0_cos) / T::from(2.).unwrap();
        a0 = T::one() + aqdb;
        a1 = T::from(-2.).unwrap() * w0_cos;
        a2 = T::one() - aqdb;
      },
      FilterMode::Bandpass => {
        b0 = aq;
        b1 = T::zero();
        b2 = -aq;
        a0 = T::one() + aq;
        a1 = T::from(-2.).unwrap() * w0_cos;
        a2 = T::one() - aq;
      },
      FilterMode::Notch => {
        b0 = T::one();
        b1 = T::from(-2.).unwrap() * w0_cos;
        b2 = T::one();
        a0 = T::one() + aq;
        a1 = T::from(-2.).unwrap() * w0_cos;
        a2 = T::one() - aq;
      },
      FilterMode::Peak => {
        b0 = T::one() + aq * A;
        b1 = T::from(-2.).unwrap() * w0_cos;
        b2 = T::one() - aq * A;
        a0 = T::one() + aq / A;
        a1 = T::from(-2.).unwrap() * w0_cos;
        a2 = T::one() - aq / A;
      },
      FilterMode::Lowshelf => {
        #[allow(non_snake_case)]
        let A_sqrt = A.sqrt();
        b0 = A * ((A + T::one()) - (A - T::one()) * w0_cos + T::from(2.).unwrap() * a_s * A_sqrt);
        b1 = T::from(2.).unwrap() * A * ((A - T::one()) - (A + T::one()) * w0_cos);
        b2 = A * ((A + T::one()) - (A - T::one()) * w0_cos - T::from(2.).unwrap() * a_s * A_sqrt);
        a0 = (A + T::one()) + (A - T::one()) * w0_cos + T::from(2.).unwrap() * a_s * A_sqrt;
        a1 = T::from(-2.).unwrap() * ((A - T::one()) + (A + T::one()) * w0_cos);
        a2 = (A + T::one()) + (A - T::one()) * w0_cos - T::from(2.).unwrap() * a_s * A_sqrt;
      },
      FilterMode::Highshelf => {
        #[allow(non_snake_case)]
        let A_sqrt = A.sqrt();
        b0 = A * ((A + T::one()) + (A - T::one()) * w0_cos + T::from(2.).unwrap() * a_s * A_sqrt);
        b1 = T::from(-2.).unwrap() * A * ((A - T::one()) + (A + T::one()) * w0_cos);
        b2 = A * ((A + T::one()) + (A - T::one()) * w0_cos - T::from(2.).unwrap() * a_s * A_sqrt);
        a0 = (A + T::one()) - (A - T::one()) * w0_cos + T::from(2.).unwrap() * a_s * A_sqrt;
        a1 = T::from(2.).unwrap() * ((A - T::one()) - (A + T::one()) * w0_cos);
        a2 = (A + T::one()) - (A - T::one()) * w0_cos - T::from(2.).unwrap() * a_s * A_sqrt;
      },
      FilterMode::Allpass => {
        b0 = T::one() - aq;
        b1 = T::from(-2.).unwrap() * w0_cos;
        b2 = T::one() + aq;
        a0 = T::one() + aq;
        a1 = T::from(-2.).unwrap() * w0_cos;
        a2 = T::one() - aq;
      },
    }

    (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
  }

  /// Computes the frequency and phase response of the biquad filter at a specified frequency.
  ///
  /// Returns `(magnitude_db, phase_rads)`.
  pub fn compute_response(
    mode: FilterMode,
    q: T,
    cutoff_freq: T,
    gain: T,
    test_freq: T,
    sample_rate: T,
  ) -> (T, T) {
    let (b0, b1, b2, a1, a2) = Self::compute_coefficients(mode, q, cutoff_freq, gain);
    let omega = T::from(2.).unwrap() * T::PI() * test_freq / sample_rate;
    Self::compute_response_from_coefficients(b0, b1, b2, a1, a2, omega)
  }

  /// Computes the frequency and phase response of the biquad filter over a logarithmically spaced
  /// grid from `start_freq` to the nyquist.
  ///
  /// `start_freq` must be non-zero and smaller than the nyquist (`sample_rate/2`).
  ///
  /// Returns (frequencies_hz, magnitude_linear, phase_rads)
  pub fn compute_response_grid<O: Float>(
    mode: FilterMode,
    q: T,
    cutoff_freq: T,
    gain: T,
    start_freq: T,
    sample_rate: T,
    grid_points: usize,
  ) -> (Vec<O>, Vec<O>, Vec<O>) {
    assert!(start_freq > T::zero(), "start frequency must be > 0");
    assert!(
      start_freq < T::from(NYQUIST).unwrap(),
      "start frequency must be less than the nyquist"
    );
    assert!(grid_points > 0, "need at least one grid point to sample");

    let (b0, b1, b2, a1, a2) = Self::compute_coefficients(mode, q, cutoff_freq, gain);

    let mut freqs = Vec::with_capacity(grid_points);
    let mut mags = Vec::with_capacity(grid_points);
    let mut phases = Vec::with_capacity(grid_points);
    if grid_points == 1 {
      let omega = T::from(2.).unwrap() * T::PI() * start_freq / sample_rate;
      let (mag_db, phase) = Self::compute_response_from_coefficients(b0, b1, b2, a1, a2, omega);
      freqs.push(O::from(start_freq).unwrap());
      mags.push(db_to_gain_generic(O::from(mag_db).unwrap()));
      phases.push(O::from(phase).unwrap());
      return (freqs, mags, phases);
    }

    let multiplier =
      (T::from(NYQUIST).unwrap() / start_freq).powf(T::one() / (T::from(grid_points - 1).unwrap()));
    for i in 0..grid_points {
      let freq = start_freq * multiplier.powi(i as i32);
      let omega = T::from(2.).unwrap() * T::PI() * freq / sample_rate;
      // TODO: Need a batch version of this function with hard-coded min/max frequency range and
      // grid size so that much of the math can be pre-computed for efficiency
      let (mag_db, phase) = Self::compute_response_from_coefficients(b0, b1, b2, a1, a2, omega);
      freqs.push(O::from(freq).unwrap());
      mags.push(db_to_gain_generic(O::from(mag_db).unwrap()));
      phases.push(O::from(phase).unwrap());
    }

    (freqs, mags, phases)
  }

  pub fn compute_chain_response_grid<O: Float + MulAssign + AddAssign, const LEN: usize>(
    mode: FilterMode,
    params: [ComputeGridFilterParams<T>; LEN],
    start_freq: T,
    sample_rate: T,
    grid_points: usize,
  ) -> (Vec<O>, Vec<O>, Vec<O>) {
    if LEN == 0 {
      panic!("LEN must be > 0");
    } else if LEN == 1 {
      return Self::compute_response_grid(
        mode,
        params[0].q,
        params[0].cutoff_freq,
        params[0].gain,
        start_freq,
        sample_rate,
        grid_points,
      );
    }

    let base_q = params[0].q;
    let base_freq = params[0].cutoff_freq;
    let base_gain = params[0].gain;
    let (freqs, mut mags, mut phases) = Self::compute_response_grid(
      mode,
      base_q,
      base_freq,
      base_gain,
      start_freq,
      sample_rate,
      grid_points,
    );

    for i in 1..LEN {
      let (_o_freqs, o_mags, o_phases) = Self::compute_response_grid(
        mode,
        params[i].q,
        params[i].cutoff_freq,
        params[i].gain,
        start_freq,
        sample_rate,
        grid_points,
      );

      for j in 0..grid_points {
        mags[j] *= o_mags[j];
        phases[j] += o_phases[j];
      }
    }

    (freqs, mags, phases)
  }

  /// Helper function that computes the magnitude and phase response given precomputed coefficients.
  ///
  /// `ω` is the angular frequency (in rads/sample) at which to sample the response.
  ///
  /// Returns `(magnitude_db, phase_rads)`
  fn compute_response_from_coefficients(b0: T, b1: T, b2: T, a1: T, a2: T, ω: T) -> (T, T) {
    let j = Complex::<T>::i();
    // let e_jω = (-j * ω).exp();
    // the `Complex::exp()` impl handles a lot of edge cases that aren't necessary.
    let neg_jω = -j * ω;
    let e_jω = Complex::from_polar(neg_jω.re.exp(), neg_jω.im);
    let e_j2ω = e_jω * e_jω;

    let num = Complex::new(b0, T::zero())
      + Complex::new(b1, T::zero()) * e_jω
      + Complex::new(b2, T::zero()) * e_j2ω;
    let den = Complex::new(T::one(), T::zero())
      + Complex::new(a1, T::zero()) * e_jω
      + Complex::new(a2, T::zero()) * e_j2ω;

    let h = num / den;
    let magnitude_db = T::from(20.).unwrap() * h.norm().log10();
    let phase = h.arg();

    (magnitude_db, phase)
  }

  #[inline]
  pub fn set_coefficients(&mut self, mode: FilterMode, q: T, freq: T, gain: T) {
    let (b0_over_a0, b1_over_a0, b2_over_a0, a1_over_a0, a2_over_a0) =
      Self::compute_coefficients(mode, q, freq, gain);

    self.b0_over_a0 = b0_over_a0;
    self.b1_over_a0 = b1_over_a0;
    self.b2_over_a0 = b2_over_a0;
    self.a1_over_a0 = a1_over_a0;
    self.a2_over_a0 = a2_over_a0;
  }

  #[inline]
  pub fn new(mode: FilterMode, q: T, freq: T, gain: T) -> BiquadFilter<T> {
    let mut filter = BiquadFilter::default();
    filter.set_coefficients(mode, q, freq, gain);
    filter
  }

  /// Called when a voice is gated.  Resets internal filter states to make it like the filter has
  /// been fed silence for an infinite amount of time.
  #[inline]
  pub fn reset(&mut self) {
    self.x = [T::zero(); 2];
    self.y = [T::zero(); 2];
  }

  #[inline]
  pub fn apply(&mut self, input: T) -> T {
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
    input: T,
    b0_over_a0: T,
    b1_over_a0: T,
    b2_over_a0: T,
    a1_over_a0: T,
    a2_over_a0: T,
  ) -> T {
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
    q: T,
    freq: T,
    gain: T,
    input: T,
  ) -> T {
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
    base_q: T,
    qs: &[T; FRAME_SIZE],
    freqs: &[T; FRAME_SIZE],
    gains: &[T; FRAME_SIZE],
    frame: &mut [T; FRAME_SIZE],
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
    cutoff_freq: &[T; FRAME_SIZE],
    q: T,
    frame: &mut [T; FRAME_SIZE],
  ) {
    let mut x = self.x;
    let mut y = self.y;

    for i in 0..FRAME_SIZE {
      let freq = cutoff_freq[i];
      let (b0_over_a0, b1_over_a0, b2_over_a0, a1_over_a0, a2_over_a0) =
        Self::compute_coefficients(mode, q, freq, T::zero());

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
    q: T,
    freqs: &[T; FRAME_SIZE],
    gains: &[T; FRAME_SIZE],
    frame: &mut [T; FRAME_SIZE],
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

/// Computes Q factors that can be set on a group of biquad filters of a given order connected in
/// series to generate a flat frequency response that starts dropping off exactly at the cutoff
/// frequency without boosting at all above.
///
/// higher-order filter Q factors determined using this: https://www.earlevel.com/main/2016/09/29/cascading-filters/
/// (wayback: https://web.archive.org/web/20241203113520/https://www.earlevel.com/main/2016/09/29/cascading-filters/)
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
