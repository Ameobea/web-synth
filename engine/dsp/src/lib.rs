#![feature(portable_simd)]

use fastapprox::fast;

pub mod band_splitter;
pub mod circular_buffer;
pub mod filters;
pub mod lookup_tables;
pub mod oscillator;
pub mod rms_level_detector;

pub const SAMPLE_RATE: f32 = 44_100.;
pub const NYQUIST: f32 = SAMPLE_RATE / 2.;
pub const FRAME_SIZE: usize = 128;

/// For `coefficient` values between 0 and 1, applies smoothing to a value, interpolating between
/// previous values and new values.  Values closer to 0 applier heavier smoothing.
///
/// This works as a filter for audio in the same vein as `y(n) = x(n) + x(n - 1)` where `state` is
/// `x(n - 1)` and `new_val` is `x(n)`.  It can be made to function as either a lowpass or highpass
/// filter depending on the value of `coefficient`.
///
/// Based off of https://github.com/pichenettes/stmlib/blob/master/dsp/dsp.h#L77
#[inline]
pub fn one_pole(state: &mut f32, new_val: f32, coefficient: f32) -> f32 {
  *state += coefficient * (new_val - *state);
  *state
}

/// Low pass filter that smooths changes in a signal.  This is helpful to avoid audio artifacts that
/// are caused by input parameters jumping quickly between values.
///
/// `smooth_factor` determines the amount of smoothing that is applied.  The closer to 1.0 you get,
/// the smoother it is.
#[inline]
pub fn smooth(state: &mut f32, new_val: f32, smooth_factor: f32) -> f32 {
  *state = smooth_factor * *state + (1. - smooth_factor) * new_val;
  *state
}

#[inline]
pub fn clamp(min: f32, max: f32, val: f32) -> f32 {
  if val > max {
    max
  } else if val < min {
    min
  } else {
    val
  }
}

/// Same as `clamp()` but converts infinite, subnormal, and NaN values to `0`.
#[inline]
pub fn clamp_normalize(min: f32, max: f32, val: f32) -> f32 {
  if !val.is_normal() {
    return val;
  }
  clamp(min, max, val)
}

#[inline]
pub fn mix(v1_pct: f32, v1: f32, v2: f32) -> f32 { (v1_pct * v1) + (1. - v1_pct) * v2 }

#[inline]
pub fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
  let t = clamp(0., 1., (x - edge0) / (edge1 - edge0));
  t * t * (3. - 2. * t)
}

#[inline]
pub fn read_interpolated(buf: &[f32], index: f32) -> f32 {
  let base_ix = index.trunc() as usize;
  let next_ix = base_ix + 1;
  if cfg!(debug_assertions) {
    mix(index.fract(), buf[next_ix], buf[base_ix])
  } else {
    unsafe {
      mix(
        index.fract(),
        *buf.get_unchecked(next_ix),
        *buf.get_unchecked(base_ix),
      )
    }
  }
}

/// Same as `fastapprox::faster::pow2` except we elide the check for large negative values and
/// assume that negative values will never be passed to this function
#[inline]
pub fn even_faster_pow2(p: f32) -> f32 {
  let v = ((1 << 23) as f32 * (p + 126.94269504_f32)) as u32;
  fastapprox::bits::from_bits(v)
}

/// Same as `fastapprox::faster::pow` except we elide the check for large negative values and
/// assume that negative values will never be passed to this function
#[inline]
pub fn even_faster_pow(x: f32, p: f32) -> f32 { even_faster_pow2(p * fastapprox::faster::log2(x)) }

#[inline]
pub fn mk_linear_to_log(logmin: f32, logmax: f32, logsign: f32) -> impl Fn(f32) -> f32 {
  move |x| {
    logsign * fast::exp(fast::ln(logmin) + ((fast::ln(logmax) - fast::ln(logmin)) * x) / 100.)
  }
}

#[inline]
pub fn mk_log_to_linear(logmin: f32, logmax: f32, logsign: f32) -> impl Fn(f32) -> f32 {
  move |y| {
    ((fast::ln(y * logsign) - fast::ln(logmin)) * 100.) / (fast::ln(logmax) - fast::ln(logmin))
  }
}

#[inline]
pub fn quantize(min: f32, max: f32, steps: f32, val: f32) -> f32 {
  let step_size = (max - min) / steps;
  let quantized = (val - min) / step_size;
  let quantized_int = quantized.round() as usize;
  min + (quantized_int as f32) * step_size
}

#[inline]
pub fn midi_number_to_frequency(midi_number: usize) -> f32 {
  (2.0f32).powf((midi_number as f32 - 69.) / 12.) * 440.
}

#[inline]
pub fn linear_to_db_checked(res: f32) -> f32 {
  let db = 20. * res.ln() / std::f32::consts::LN_10;
  if db > 100. {
    return 100.;
  } else if db < -100. {
    return -100.;
  }

  if db.is_nan() {
    -100.
  } else {
    db
  }
}

#[inline]
pub fn pow10(x: f32) -> f32 {
  // TODO: check out fastapprox exp
  (x * 2.30258509299404568402).exp()
  // 10f32.powf(x)
}

#[inline]
pub fn db_to_gain(db: f32) -> f32 {
  // 10f32.powf(db / 20.)
  pow10(db / 20.)
}

#[inline]
pub fn gain_to_db(threshold: f32) -> f32 {
  if threshold == 0. {
    return -1000.;
  }

  20. * threshold.log10()
}

#[test]
fn db_conversion() {
  assert_eq!(gain_to_db(1.), 0.);
  assert_eq!(gain_to_db(0.5), -6.0206003);
  assert_eq!(gain_to_db(0.25), -12.041201);
  assert_eq!(gain_to_db(0.125), -18.0618);
}

#[test]
fn test_quantize() {
  assert_eq!(quantize(0., 100., 10., 0.2), 0.);
  assert_eq!(quantize(0., 100., 10., 10.2), 10.);
  assert_eq!(quantize(0., 100., 10., 51.), 50.);
  assert_eq!(quantize(0., 100., 10., 100.), 100.);
  assert_eq!(quantize(0., 100., 10., 101.), 100.);

  assert_eq!(quantize(-1., 1., 20., -0.23), -0.19999999);
  assert_eq!(quantize(-1., 1., 20., 0.98), 1.);

  assert_eq!(quantize(0., 1., 1., 0.4), 0.);
  assert_eq!(quantize(0., 1., 1., 0.6), 1.);
}
