use std::ptr;

use rand_pcg::Pcg32;

use super::prelude::*;

pub static mut RNG: *mut Pcg32 = ptr::null_mut();

pub fn rng() -> &'static mut Pcg32 { unsafe { &mut *RNG } }

pub unsafe fn init_state() {
    skip_list::SKIP_LIST_NODE_DEBUG_POINTERS = Box::into_raw(box skip_list::blank_shortcuts());
    RNG = Box::into_raw(box Pcg32::new(
        0x1ade_f00d_d15b_a5e5,
        721_347_520_420_481_703,
    ))
}
