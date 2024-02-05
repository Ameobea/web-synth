use std::f32::consts::PI;

use common::ref_static_mut;
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
      if fast {
        let phase =
          (sample_ix as f32 / WAVEFORM_LENGTH_SAMPLES as f32) * harmonic_ix as f32 + -*phase;
        let phase = phase.fract();
        let phase = if phase < 0. { phase + 1. } else { phase };
        let lut = dsp::lookup_tables::get_sine_lookup_table();
        *sample += magnitude * dsp::read_interpolated(lut, phase * lut.len() as f32);
      } else {
        let phase =
          (sample_ix as f32 / WAVEFORM_LENGTH_SAMPLES as f32) * PI * 2. * harmonic_ix as f32
            + -*phase * PI * 2.;
        *sample += magnitude * phase.sin();
      }
    }
  }

  // normalize
  let (min, max) = buf.iter().fold(
    (std::f32::INFINITY, std::f32::NEG_INFINITY),
    |(min, max), x| (min.min(*x), max.max(*x)),
  );
  let abs_max = min.abs().max(max.abs());
  if abs_max > 0. {
    for sample in buf.iter_mut() {
      *sample /= abs_max;
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

  let ctx = Box::into_raw(Box::new(WaveformRendererCtx::new(
    WAVEFORM_LENGTH_SAMPLES as u32,
    SAMPLE_RATE as f32,
    WAVEFORM_WIDTH_PX,
    WAVEFORM_HEIGHT_PX,
  )));
  unsafe { WAVEFORM_RENDERER_CTX = ctx };
  unsafe { &mut *WAVEFORM_RENDERER_CTX }
}

/// State format:
/// [WAVEFORM_SIZE * HARMONIC_COUNT] f32s for the magnitudes
/// [WAVEFORM_SIZE * HARMONIC_COUNT] f32s for the phases
#[no_mangle]
pub extern "C" fn wavegen_render_waveform() -> *const u8 {
  common::set_raw_panic_hook(log_err);

  let state = ref_static_mut!(ENCODED_STATE_BUF);
  let magnitudes = &mut state[..HARMONIC_COUNT];
  // normalize magnitudes
  let max_magnitude = magnitudes.iter().fold(0.0f32, |acc, x| acc.max(*x));
  if max_magnitude > 0. {
    for magnitude in magnitudes.iter_mut() {
      *magnitude /= max_magnitude;
    }
  }
  let magnitudes = &state[..HARMONIC_COUNT];
  let phases = &state[HARMONIC_COUNT..];

  let ctx = get_waveform_renderer_ctx();
  let fast = true;
  if fast {
    dsp::lookup_tables::maybe_init_lookup_tables();
  }
  build_waveform(&mut ctx.waveform_buf, magnitudes, phases, fast);
  waveform_renderer::render_waveform(ctx, 0., 100_000_000.)
}

#[no_mangle]
pub extern "C" fn wavegen_get_waveform_buf_ptr() -> *const f32 {
  let ctx = get_waveform_renderer_ctx();
  ctx.waveform_buf.as_ptr()
}
