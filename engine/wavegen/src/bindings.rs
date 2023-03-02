use std::f32::consts::PI;

use waveform_renderer::WaveformRendererCtx;

extern "C" {
    fn log_err(s: *const u8, len: usize);
}

const WAVEFORM_LENGTH_SAMPLES: usize = 1024 * 4;
const HARMONIC_COUNT: usize = 64;
const WAVEFORM_HEIGHT_PX: u32 = 256;
const WAVEFORM_WIDTH_PX: u32 = 1024;
const SAMPLE_RATE: u32 = 44_100;

fn build_waveform(buf: &mut Vec<f32>, magnitudes: &[f32], phases: &[f32], fast: bool) {
    buf.fill(0.);
    buf.resize(WAVEFORM_LENGTH_SAMPLES, 0.);
    for (harmonic_ix, (magnitude, phase)) in magnitudes.iter().zip(phases).enumerate() {
        if *magnitude == 0. {
            continue;
        }

        for (sample_ix, sample) in buf.iter_mut().enumerate() {
            let phase =
                (sample_ix as f32 / WAVEFORM_LENGTH_SAMPLES as f32) * PI * 2. * harmonic_ix as f32
                    + -*phase * PI * 2.;
            if fast {
                *sample += magnitude * fastapprox::fast::sinfull(phase);
            } else {
                *sample += magnitude * phase.sin();
            }
        }
    }
}

static mut WAVEFORM_RENDERER_CTX: *mut WaveformRendererCtx = std::ptr::null_mut();
static mut ENCODED_STATE_BUF: [f32; HARMONIC_COUNT * 2] = [0.; HARMONIC_COUNT * 2];

#[no_mangle]
pub extern "C" fn get_encoded_state_buf_ptr() -> *mut f32 {
    unsafe { ENCODED_STATE_BUF.as_mut_ptr() }
}

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
#[no_mangle]
pub extern "C" fn wavegen_render_waveform() -> *const u8 {
    common::set_raw_panic_hook(log_err);

    let state = unsafe { &mut ENCODED_STATE_BUF };
    let magnitudes = &mut state[..HARMONIC_COUNT];
    // normalize magnitudes
    let max_magnitude = magnitudes.iter().fold(0.0f32, |acc, x| acc.max(*x));
    if max_magnitude > 0. {
        for magnitude in magnitudes.iter_mut() {
            *magnitude /= max_magnitude;
        }
    }
    drop(magnitudes);
    let magnitudes = &state[..HARMONIC_COUNT];
    let phases = &state[HARMONIC_COUNT..];

    let ctx = get_waveform_renderer_ctx();
    build_waveform(&mut ctx.waveform_buf, magnitudes, phases, true);
    waveform_renderer::render_waveform(ctx, 0, 100_000_000)
}

#[no_mangle]
pub extern "C" fn wavegen_get_waveform_buf_ptr() -> *const f32 {
    let ctx = get_waveform_renderer_ctx();
    ctx.waveform_buf.as_ptr()
}
