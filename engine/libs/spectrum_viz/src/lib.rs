#[macro_use]
extern crate lazy_static;

use std::mem;

use palette::{
    encoding::{linear::Linear, srgb::Srgb},
    gradient::Gradient,
    rgb::Rgb,
};
use wasm_bindgen::prelude::*;

const BUFFER_SIZE: usize = 8192;

pub struct Context {
    pub byte_frequency_data: [u8; BUFFER_SIZE],
    pub pixel_buffer: [u8; BUFFER_SIZE * 4],
    pub pixel_scaler_fn: usize,
}

lazy_static! {
    pub static ref PINK_GRADIENT_LUT: [[u8; 4]; 255] = {
        let gradient: Gradient<Rgb<Linear<Srgb>>> = Gradient::with_domain(vec![
            (0., Rgb::new(0., 0., 0.)),
            (1., Rgb::new(1., 0.752941, 0.79607843)),
        ]);

        let mut lut = [[0; 4]; 255];
        for i in 0..255 {
            let color = gradient.get((i as f32) / 255.);
            lut[i] = [
                (color.red * 255.) as u8,
                (color.green * 255.) as u8,
                (color.blue * 255.) as u8,
                255,
            ];
        }

        lut
    };
}

fn pink_scaler(val: u8) -> [u8; 4] { *unsafe { PINK_GRADIENT_LUT.get_unchecked(val as usize) } }

const PIXEL_SCALER_FNS: &[fn(val: u8) -> [u8; 4]] = &[pink_scaler];

#[wasm_bindgen]
pub fn new_context(pixel_scaler_fn: usize) -> *mut Context {
    let ctx = Context {
        byte_frequency_data: [255u8; BUFFER_SIZE],
        pixel_buffer: [255u8; BUFFER_SIZE * 4],
        pixel_scaler_fn,
    };
    Box::into_raw(Box::new(ctx))
}

#[wasm_bindgen]
pub fn set_pixel_scaler_fn(ctx_ptr: *mut Context, pixel_scaler_fn: usize) {
    let mut ctx = unsafe { Box::from_raw(ctx_ptr) };
    ctx.pixel_scaler_fn = pixel_scaler_fn;
    mem::forget(ctx);
}

#[wasm_bindgen]
pub fn process_viz_data(ctx_ptr: *mut Context) {
    let mut ctx = unsafe { Box::from_raw(ctx_ptr) };
    let scaler_fn = PIXEL_SCALER_FNS
        .get(ctx.pixel_scaler_fn)
        .unwrap_or_else(|| panic!("No pixel scaler found with index {}", ctx.pixel_scaler_fn));

    for (i, val) in (&ctx.byte_frequency_data[..]).iter().enumerate() {
        let [r, g, b, _] = scaler_fn(*val);
        ctx.pixel_buffer[i * 4] = r;
        ctx.pixel_buffer[i * 4 + 1] = g;
        ctx.pixel_buffer[i * 4 + 2] = b;
    }

    mem::forget(ctx);
}

#[wasm_bindgen]
pub fn get_byte_frequency_data_ptr(ctx_ptr: *mut Context) -> *const [u8; BUFFER_SIZE] {
    let ctx = unsafe { Box::from_raw(ctx_ptr) };
    let byte_array_ptr = &ctx.byte_frequency_data as *const _;
    mem::forget(ctx);
    byte_array_ptr
}

#[wasm_bindgen]
pub fn get_pixel_data_ptr(ctx_ptr: *mut Context) -> *const [u8; BUFFER_SIZE * 4] {
    let ctx = unsafe { Box::from_raw(ctx_ptr) };
    let byte_array_ptr = &ctx.pixel_buffer as *const _;
    mem::forget(ctx);
    byte_array_ptr
}

#[wasm_bindgen]
pub fn drop_context(ctx_ptr: *mut Context) { drop(unsafe { Box::from_raw(ctx_ptr) }) }
