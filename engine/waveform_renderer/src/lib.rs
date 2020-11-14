#![feature(box_syntax)]

use wasm_bindgen::prelude::*;

const BYTES_PER_PX: usize = 4; // RGBA

pub struct WaveformRendererCtx {
    pub waveform_length_samples: u32,
    pub sample_rate: u32,
    pub width_px: u32,
    pub height_px: u32,
    pub waveform_buf: Vec<f32>,
    pub image_data_buf: Vec<u8>,
}

#[wasm_bindgen]
pub fn create_waveform_renderer_ctx(
    waveform_length_samples: u32,
    sample_rate: u32,
    width_px: u32,
    height_px: u32,
) -> *mut WaveformRendererCtx {
    let mut ctx = box WaveformRendererCtx {
        waveform_length_samples,
        sample_rate,
        width_px,
        height_px,
        waveform_buf: Vec::with_capacity(waveform_length_samples as usize),
        image_data_buf: Vec::with_capacity(width_px as usize * height_px as usize * BYTES_PER_PX),
    };
    unsafe {
        ctx.waveform_buf.set_len(waveform_length_samples as usize);
        ctx.image_data_buf
            .set_len(width_px as usize * height_px as usize * BYTES_PER_PX);
    }
    Box::into_raw(ctx)
}

#[wasm_bindgen]
pub fn free_waveform_renderer_ctx(ctx: *mut WaveformRendererCtx) {
    drop(unsafe { Box::from_raw(ctx) })
}

#[wasm_bindgen]
pub fn get_waveform_buf_ptr(ctx: *mut WaveformRendererCtx) -> *mut f32 {
    unsafe { (*ctx).waveform_buf.as_mut_ptr() }
}

#[wasm_bindgen]
pub fn render_waveform(ctx: *mut WaveformRendererCtx, start_ms: u32, end_ms: u32) -> *const u8 {
    let ctx = unsafe { &mut *ctx };
    for i in 0..2000 {
        ctx.image_data_buf[i * 3] = 255;
    }
    // TODO
    ctx.image_data_buf.as_mut_ptr()
}
