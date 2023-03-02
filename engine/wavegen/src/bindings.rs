use std::f32::consts::PI;

use wasm_bindgen::prelude::*;
use waveform_renderer::WaveformRendererCtx;

const WAVEFORM_LENGTH_SAMPLES: usize = 1024 * 4;
const HARMONIC_COUNT: usize = 64;
const WAVEFORM_HEIGHT_PX: u32 = 256;
const WAVEFORM_WIDTH_PX: u32 = 1024;
const SAMPLE_RATE: u32 = 44_100;

fn build_waveform(buf: &mut Vec<f32>, magnitudes: &[f32], phases: &[f32]) {
    buf.fill(0.);
    buf.resize(WAVEFORM_LENGTH_SAMPLES, 0.);
    for (harmonic_ix, (magnitude, phase)) in magnitudes.iter().zip(phases).enumerate() {
        for (sample_ix, sample) in buf.iter_mut().enumerate() {
            let phase =
                (sample_ix as f32 / WAVEFORM_LENGTH_SAMPLES as f32) * PI * 2. * harmonic_ix as f32
                    + -*phase * PI * 2.;
            // *sample += magnitude * phase.sin();
            *sample += magnitude * fastapprox::fast::sinfull(phase);
        }
    }
}

static mut WAVEFORM_RENDERER_CTX: *mut WaveformRendererCtx = std::ptr::null_mut();

fn get_waveform_renderer_ctx() -> &'static mut WaveformRendererCtx {
    if !unsafe { WAVEFORM_RENDERER_CTX.is_null() } {
        return unsafe { &mut *WAVEFORM_RENDERER_CTX };
    }

    let ctx = Box::into_raw(box WaveformRendererCtx::new(
        WAVEFORM_LENGTH_SAMPLES as u32,
        SAMPLE_RATE,
        WAVEFORM_WIDTH_PX,
        WAVEFORM_HEIGHT_PX,
    ));
    unsafe { WAVEFORM_RENDERER_CTX = ctx };
    unsafe { &mut *WAVEFORM_RENDERER_CTX }
}

/// State format:
/// [WAVEFORM_SIZE * HARMONIC_COUNT] f32s for the magnitudes
/// [WAVEFORM_SIZE * HARMONIC_COUNT] f32s for the phases
#[wasm_bindgen]
pub fn render_waveform(state: &[f32]) -> *const u8 {
    console_error_panic_hook::set_once();

    assert_eq!(state.len(), HARMONIC_COUNT * 2, "Invalid state length");
    let magnitudes = &state[..HARMONIC_COUNT];
    let phases = &state[HARMONIC_COUNT..];

    let ctx = get_waveform_renderer_ctx();
    build_waveform(&mut ctx.waveform_buf, magnitudes, phases);
    waveform_renderer::render_waveform(ctx, 0, 100_000_000)
}
