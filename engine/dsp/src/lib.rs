use fastapprox::fast;

pub mod circular_buffer;
pub mod filters;
pub mod oscillator;

pub const SAMPLE_RATE: f32 = 44_100.;

/// For `coefficient` values between 0 and 1, applies smoothing to a value, interpolating between
/// previous values and new values.  Values closer to 1 applier heavier smoothing.
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
pub fn smooth(state: &mut f32, new_val: f32, smooth_factor: f32) {
    *state = smooth_factor * *state + (1. - smooth_factor) * new_val;
}

#[inline]
pub fn clamp(min: f32, max: f32, val: f32) -> f32 { val.max(min).min(max) }

#[inline]
pub fn mix(v1_pct: f32, v1: f32, v2: f32) -> f32 { (v1_pct * v1) + (1. - v1_pct) * v2 }

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
pub fn even_faster_pow2(p: f32) -> f32 {
    let v = ((1 << 23) as f32 * (p + 126.94269504_f32)) as u32;
    fastapprox::bits::from_bits(v)
}

/// Same as `fastapprox::faster::pow` except we elide the check for large negative values and
/// assume that negative values will never be passed to this function
pub fn even_faster_pow(x: f32, p: f32) -> f32 { even_faster_pow2(p * fastapprox::faster::log2(x)) }

pub fn mk_linear_to_log(logmin: f32, logmax: f32, logsign: f32) -> impl Fn(f32) -> f32 {
    move |x| {
        logsign * fast::exp(fast::ln(logmin) + ((fast::ln(logmax) - fast::ln(logmin)) * x) / 100.)
    }
}

pub fn mk_log_to_linear(logmin: f32, logmax: f32, logsign: f32) -> impl Fn(f32) -> f32 {
    move |y| {
        ((fast::ln(y * logsign) - fast::ln(logmin)) * 100.) / (fast::ln(logmax) - fast::ln(logmin))
    }
}
