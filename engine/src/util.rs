use std::mem;

use rand::prelude::*;
use uuid::Uuid;

use crate::rng;

pub fn tern<T>(cond: bool, if_true: T, if_false: T) -> T {
    if cond {
        if_true
    } else {
        if_false
    }
}

pub fn clamp(val: f32, min: f32, max: f32) -> f32 { val.max(min).min(max) }

pub fn uuid_v4() -> Uuid {
    let entropy: (u64, i64) = rng().gen();
    unsafe { mem::transmute(entropy) }
}
