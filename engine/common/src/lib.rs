#![feature(box_syntax, thread_local)]

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

pub fn rng() -> &'static mut Pcg32 { unsafe { &mut RNG } }

pub fn uuid_v4() -> Uuid {
    let entropy: (u64, i64) = rng().gen();
    unsafe { mem::transmute(entropy) }
}
