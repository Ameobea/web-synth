#![feature(thread_local)]

use std::mem;

use rand::prelude::*;
use rand_pcg::Pcg32;
use uuid::Uuid;

mod init;

pub use crate::init::*;

// Transmuted `rand_pcg::Pcg32::new(0xcafef00dd15ea5e5, 0xa02bdbf7bb3c0a7)` since it's not const atm
#[thread_local]
static mut RNG: Pcg32 =
  unsafe { std::mem::transmute([5573589319906701683u64, 1442695040888963407u64]) };

#[inline(always)]
pub fn rng() -> &'static mut Pcg32 { ref_static_mut!(RNG) }

pub fn uuid_v4() -> Uuid {
  let entropy: (u64, i64) = rng().gen();
  unsafe { mem::transmute(entropy) }
}

pub fn set_raw_panic_hook(log_err: unsafe extern "C" fn(ptr: *const u8, len: usize)) {
  let hook = move |info: &std::panic::PanicHookInfo| {
    let msg = format!("PANIC: {}", info.to_string());
    let bytes = msg.into_bytes();
    let len = bytes.len();
    let ptr = bytes.as_ptr();
    unsafe { log_err(ptr, len) }
  };

  std::panic::set_hook(Box::new(hook))
}

/// Implements `&mut *std::ptr::addr_of_mut!(x)` to work around the annoying new Rust rules on
/// referencing static muts
#[macro_export]
macro_rules! ref_static_mut {
  ($x:expr) => {
    unsafe { &mut *std::ptr::addr_of_mut!($x) }
  };
}
