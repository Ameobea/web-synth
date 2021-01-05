pub mod circular_buffer;
pub mod filters;
pub mod oscillator;

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
