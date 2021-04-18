#![feature(box_syntax, thread_local)]

use std::mem;

#[cfg(feature = "bindgen")]
#[macro_use]
extern crate serde_derive;

use rand::prelude::*;
use rand_pcg::Pcg32;
use uuid::Uuid;

mod init;

pub use crate::init::*;

#[repr(packed)]
#[cfg(feature = "bindgen")]
#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
pub struct RawNoteData {
    pub line_ix: u32,
    pub padding: u32,
    pub start_beat: f64,
    pub width: f64,
}

// Transmuted `rand_pcg::Pcg32::new(0xcafef00dd15ea5e5, 0xa02bdbf7bb3c0a7)` since it's not const atm
#[thread_local]
pub static mut RNG: Pcg32 =
    unsafe { std::mem::transmute([5573589319906701683u64, 1442695040888963407u64]) };

pub fn rng() -> &'static mut Pcg32 { unsafe { &mut RNG } }

pub fn uuid_v4() -> Uuid {
    let entropy: (u64, i64) = rng().gen();
    unsafe { mem::transmute(entropy) }
}
