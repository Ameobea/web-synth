#![feature(box_syntax, thread_local)]

use std::{mem, ptr};

#[macro_use]
extern crate serde_derive;

use rand::prelude::*;
use rand_pcg::Pcg32;
use uuid::Uuid;

mod init;

pub use crate::init::*;

#[derive(Serialize, Deserialize)]
pub struct RawNoteData {
    pub line_ix: usize,
    pub start_beat: f32,
    pub width: f32,
}

#[thread_local]
pub static mut RNG: *mut Pcg32 = ptr::null_mut();

pub fn rng() -> &'static mut Pcg32 { unsafe { &mut *RNG } }

pub fn uuid_v4() -> Uuid {
    let entropy: (u64, i64) = rng().gen();
    unsafe { mem::transmute(entropy) }
}
