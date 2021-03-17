use std::rc::Rc;

use crate::{Adsr, AdsrStep, RampFn, RENDERED_BUFFER_SIZE, SAMPLE_RATE};

pub struct AdsrContext {
    pub adsrs: Vec<Adsr>,
    pub most_recent_gated_ix: usize,
}

impl AdsrContext {
    pub fn new(adsrs: Vec<Adsr>) -> Self {
        AdsrContext {
            adsrs,
            most_recent_gated_ix: 0,
        }
    }
}

fn round_tiny_to_zero(val: f32) -> f32 {
    if val.abs() < 0.001 {
        0.
    } else {
        val
    }
}

fn decode_steps(encoded_steps: &[f32]) -> Vec<AdsrStep> {
    assert_eq!(
        encoded_steps.len() % 4,
        0,
        "`encoded_steps` length must be divisible by 4"
    );
    encoded_steps
        .chunks_exact(4)
        .map(|vals| match vals {
            &[x, y, ramp_fn_type, ramp_fn_param] => {
                let ramper = match ramp_fn_type {
                    x if x == 0. => RampFn::Instant,
                    x if x == 1. => RampFn::Linear,
                    x if x == 2. => RampFn::Exponential {
                        exponent: ramp_fn_param,
                    },
                    _ => unreachable!("Invalid ramp fn type val"),
                };
                AdsrStep {
                    x: round_tiny_to_zero(x),
                    y: round_tiny_to_zero(y),
                    ramper,
                }
            },
            _ => unreachable!(),
        })
        .collect()
}

static mut ENCODED_ADSR_STEP_BUF: Vec<f32> = Vec::new();

/// Resizes the step buffer to hold at least `step_count` steps (`step_count * 4` f32s)
#[no_mangle]
pub unsafe extern "C" fn get_encoded_adsr_step_buf_ptr(step_count: usize) -> *mut f32 {
    let needed_capacity = step_count * 4;
    if ENCODED_ADSR_STEP_BUF.capacity() < needed_capacity {
        let additional = needed_capacity - ENCODED_ADSR_STEP_BUF.capacity();
        ENCODED_ADSR_STEP_BUF.reserve(additional);
    }
    ENCODED_ADSR_STEP_BUF.set_len(needed_capacity);
    ENCODED_ADSR_STEP_BUF.as_mut_ptr()
}

/// `encoded_steps` should be an array of imaginary tuples like `(x, y, ramp_fn_type,
/// ramp_fn_param)`
#[no_mangle]
pub unsafe extern "C" fn create_adsr_ctx(
    loop_point: f32,
    len_ms: f32,
    release_start_phase: f32,
    adsr_count: usize,
) -> *mut AdsrContext {
    let rendered: Rc<[f32; RENDERED_BUFFER_SIZE]> =
        Rc::new(std::mem::MaybeUninit::uninit().assume_init());
    let len_samples = ms_to_samples(len_ms);
    let decoded_steps = decode_steps(ENCODED_ADSR_STEP_BUF.as_slice());
    assert!(adsr_count > 0);

    let mut adsrs = Vec::with_capacity(adsr_count);
    for _ in 0..adsr_count {
        adsrs.push(Adsr::new(
            decoded_steps.clone(),
            if loop_point < 0. {
                None
            } else {
                Some(loop_point)
            },
            len_samples,
            release_start_phase,
            Rc::clone(&rendered),
            crate::EarlyReleaseConfig::default(),
        ));
    }
    adsrs[0].render();

    Box::into_raw(box AdsrContext::new(adsrs))
}

// #[no_mangle]
// pub unsafe extern "C" fn free_adsr_ctx(ctx: *mut AdsrContext) { drop(Box::from_raw(ctx)) }

#[no_mangle]
pub unsafe extern "C" fn update_adsr_steps(ctx: *mut AdsrContext) {
    let decoded_steps = decode_steps(ENCODED_ADSR_STEP_BUF.as_slice());
    for adsr in &mut (*ctx).adsrs {
        adsr.set_steps(decoded_steps.clone());
    }
    (*ctx).adsrs[0].render();
}

fn ms_to_samples(ms: f32) -> f32 { (ms / 1000.) * SAMPLE_RATE as f32 }

#[no_mangle]
pub unsafe extern "C" fn update_adsr_len_ms(ctx: *mut AdsrContext, new_len_ms: f32) {
    for adsr in &mut (*ctx).adsrs {
        adsr.set_len_samples(ms_to_samples(new_len_ms))
    }
}

#[no_mangle]
pub unsafe extern "C" fn gate_adsr(ctx: *mut AdsrContext, index: usize) {
    (*ctx).adsrs[index].gate();
    (*ctx).most_recent_gated_ix = index;
}

#[no_mangle]
pub unsafe extern "C" fn ungate_adsr(ctx: *mut AdsrContext, index: usize) {
    (*ctx).adsrs[index].ungate()
}

/// Updates all ADSRs, rendering them to their respective output buffers.  Returns the current phase
/// of the most recent gated ADSR.
#[no_mangle]
pub unsafe extern "C" fn process_adsr(
    ctx: *mut AdsrContext,
    output_range_min: f32,
    output_range_max: f32,
) -> f32 {
    let shift = output_range_min;
    let scale = output_range_max - output_range_min;
    for adsr in &mut (*ctx).adsrs {
        adsr.render_frame(scale, shift);
    }

    (*ctx).adsrs[(*ctx).most_recent_gated_ix].phase
}

#[no_mangle]
pub unsafe extern "C" fn adsr_set_loop_point(ctx: *mut AdsrContext, new_loop_point: f32) {
    for adsr in &mut (*ctx).adsrs {
        adsr.set_loop_point(if new_loop_point < 0. {
            None
        } else {
            Some(new_loop_point)
        });
    }
}

#[no_mangle]
pub unsafe extern "C" fn adsr_set_release_start_phase(
    ctx: *mut AdsrContext,
    new_release_start_phase: f32,
) {
    for adsr in &mut (*ctx).adsrs {
        adsr.set_release_start_phase(new_release_start_phase);
    }
}

#[no_mangle]
pub unsafe extern "C" fn adsr_get_output_buf_ptr(
    ctx: *const AdsrContext,
    index: usize,
) -> *const f32 {
    (*ctx).adsrs[index].get_cur_frame_output().as_ptr()
}
