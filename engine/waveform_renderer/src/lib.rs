#[cfg(feature = "bindgen")]
use wasm_bindgen::prelude::*;

const BYTES_PER_PX: usize = 4; // RGBA

pub struct WaveformRendererCtx {
  pub sample_rate: f32,
  pub width_px: u32,
  pub height_px: u32,
  pub waveform_buf: Vec<f32>,
  pub image_data_buf: Vec<u8>,
}

impl WaveformRendererCtx {
  pub fn new(
    waveform_length_samples: u32,
    sample_rate: f32,
    width_px: u32,
    height_px: u32,
  ) -> Self {
    let mut image_data_buf =
      Vec::with_capacity(width_px as usize * height_px as usize * BYTES_PER_PX);
    unsafe { image_data_buf.set_len(width_px as usize * height_px as usize * BYTES_PER_PX) };

    let mut waveform_buf = Vec::with_capacity(waveform_length_samples as usize);
    unsafe { waveform_buf.set_len(waveform_length_samples as usize) };

    WaveformRendererCtx {
      sample_rate,
      width_px,
      height_px,
      waveform_buf,
      image_data_buf,
    }
  }
}

#[cfg(feature = "bindgen")]
#[wasm_bindgen]
pub fn create_waveform_renderer_ctx(
  waveform_length_samples: u32,
  sample_rate: f32,
  width_px: u32,
  height_px: u32,
) -> *mut WaveformRendererCtx {
  common::maybe_init(None);

  wbg_logging::maybe_init();

  Box::into_raw(Box::new(WaveformRendererCtx::new(
    waveform_length_samples,
    sample_rate,
    width_px,
    height_px,
  )))
}

#[cfg(feature = "bindgen")]
#[wasm_bindgen]
pub fn append_samples_to_waveform(ctx: *mut WaveformRendererCtx, new_samples: &[f32]) -> usize {
  let ctx = unsafe { &mut *ctx };
  ctx.waveform_buf.extend_from_slice(new_samples);
  ctx.waveform_buf.len()
}

#[cfg(feature = "bindgen")]
#[wasm_bindgen]
pub fn free_waveform_renderer_ctx(ctx: *mut WaveformRendererCtx) {
  drop(unsafe { Box::from_raw(ctx) })
}

#[cfg(feature = "bindgen")]
#[wasm_bindgen]
pub fn get_waveform_buf_ptr(ctx: *mut WaveformRendererCtx) -> *mut f32 {
  unsafe { (*ctx).waveform_buf.as_mut_ptr() }
}

#[inline(always)]
const fn ms_to_samples(sample_rate: f32, ms: f32) -> u32 { ((ms * sample_rate) / 1000.) as u32 }

#[inline(always)]
fn sample_to_y_val(sample: f32, half_height: f32, max_distance_from_0: f32) -> u32 {
  let sample_from_0_to_2 = (sample + max_distance_from_0) * (1.0 / max_distance_from_0);
  (sample_from_0_to_2 * half_height) as u32
}

#[cfg_attr(feature = "bindgen", wasm_bindgen)]
pub fn render_waveform(ctx: *mut WaveformRendererCtx, start_ms: f32, end_ms: f32) -> *const u8 {
  let ctx = unsafe { &mut *ctx };

  if ctx.waveform_buf.is_empty() {
    // Fill opaque black; the buffer is `set_len`'d over uninitialized memory, so the alpha and
    // color bytes must all be written or garbage pixels get displayed.
    for (i, cell) in ctx.image_data_buf.iter_mut().enumerate() {
      *cell = if i % 4 == 3 { 255 } else { 0 };
    }
    return ctx.image_data_buf.as_mut_ptr();
  }

  debug_assert_eq!(
    ctx.image_data_buf.len() % 8,
    0,
    "Image size byte length must be divisible by 8"
  );
  let image_data_buf_as_u64s: &mut [u64] = unsafe {
    std::slice::from_raw_parts_mut(
      ctx.image_data_buf.as_mut_ptr() as *mut _,
      ctx.image_data_buf.len() / 8,
    )
  };
  for cell in image_data_buf_as_u64s {
    *cell = unsafe { std::mem::transmute([(0u8, 0u8, 0u8, 255u8), (0u8, 0u8, 0u8, 255u8)]) };
  }

  let start_sample_ix = ms_to_samples(ctx.sample_rate, start_ms).min(ctx.waveform_buf.len() as u32);
  let end_sample_ix = ms_to_samples(ctx.sample_rate, end_ms).min(ctx.waveform_buf.len() as u32);
  // Can happen when the view is scrolled/zoomed entirely past the end of the sample; there's
  // nothing to draw, and returning here avoids a panic that would poison the render worker.
  if end_sample_ix <= start_sample_ix {
    return ctx.image_data_buf.as_mut_ptr();
  }
  assert_eq!(ctx.height_px % 2, 0, "Height must be divisible by 2");

  let len_samples = end_sample_ix - start_sample_ix;
  // Fractional so the rendered span matches the requested view exactly at any zoom.  With integer
  // division the image desynced from the selection overlay and, when fewer samples than pixels
  // were in view, the column loop read past the end of the buffer.
  let samples_per_px = len_samples as f32 / ctx.width_px as f32;

  let max_distance_from_0 = ctx.waveform_buf[start_sample_ix as usize..end_sample_ix as usize]
    .iter()
    .fold(0.0f32, |acc, sample| acc.max(sample.abs()))
    .max(1e-6);
  let half_height_f32 = (ctx.height_px / 2) as f32;
  let max_y = ctx.height_px - 1;

  let mut last_y = ctx.height_px / 2;
  for w in 0..ctx.width_px {
    let col_start = start_sample_ix + (w as f32 * samples_per_px) as u32;
    let col_end = (start_sample_ix + ((w + 1) as f32 * samples_per_px) as u32)
      .max(col_start + 1)
      .min(end_sample_ix);

    let (mut min_s, mut max_s) = (f32::INFINITY, f32::NEG_INFINITY);
    for i in col_start..col_end {
      let s = ctx.waveform_buf[i as usize];
      min_s = min_s.min(s);
      max_s = max_s.max(s);
    }

    let ya = sample_to_y_val(min_s, half_height_f32, max_distance_from_0).min(max_y);
    let yb = sample_to_y_val(max_s, half_height_f32, max_distance_from_0).min(max_y);
    let col_lo = ya.min(yb);
    let col_hi = ya.max(yb);

    // Bridge to the previous column so the trace stays continuous when zoomed in.
    for y in col_lo.min(last_y)..=col_hi.max(last_y) {
      ctx.image_data_buf[((y * ctx.width_px + w) as usize) * BYTES_PER_PX] = 255;
    }
    last_y = (col_lo + col_hi) / 2;
  }

  ctx.image_data_buf.as_mut_ptr()
}

#[cfg(feature = "bindgen")]
#[wasm_bindgen]
pub fn get_sample_count(ctx: *const WaveformRendererCtx) -> usize {
  unsafe { (*ctx).waveform_buf.len() }
}

#[cfg(feature = "bindgen")]
#[wasm_bindgen]
pub fn get_memory() -> JsValue { wasm_bindgen::memory() }
