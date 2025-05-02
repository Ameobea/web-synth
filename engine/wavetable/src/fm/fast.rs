//! Taken from `fastapprox::fast` but with some checks/extra work removed since we know things
//! statically that the compiler can't seem to figure out even with some coaxing

use fastapprox::bits::{from_bits, to_bits};

/// Base 2 logarithm.
#[inline]
pub fn log2(x: f32) -> f32 {
  let vx = to_bits(x);
  let mx = from_bits((vx & 0x007FFFFF_u32) | 0x3f000000);
  let mut y = vx as f32;
  y *= 1.1920928955078125e-7_f32;
  y - 124.22551499_f32 - 1.498030302_f32 * mx - 1.72587999_f32 / (0.3520887068_f32 + mx)
}

/// Raises 2 to a floating point power.  MUST NOT BE CALLED WITH NEGATIVE OR DENORMAL ARGUMENTS
#[inline]
pub fn pow2(p: f32) -> f32 {
  let w = p as i32;
  let z = p - (w as f32);
  let v = ((1 << 23) as f32
    * (p + 121.2740575_f32 + 27.7280233_f32 / (4.84252568_f32 - z) - 1.49012907_f32 * z))
    as u32;
  from_bits(v)
}

/// Raises a number to a floating point power.
#[inline]
pub fn pow(x: f32, p: f32) -> f32 { pow2(p * log2(x)) }
