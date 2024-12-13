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
    for (i, cell) in ctx.image_data_buf.iter_mut().enumerate() {
      if i % 4 == 0 {
        *cell = 0;
      }
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
  assert!(
    end_sample_ix > start_sample_ix,
    "Start sample after end? start_ms={}, end_ms={}, start_sample_ix={}, end_sample_ix={}",
    start_ms,
    end_ms,
    start_sample_ix,
    end_sample_ix
  );

  let len_samples = end_sample_ix - start_sample_ix;
  let samples_per_px = (len_samples / ctx.width_px).max(1);
  assert_eq!(ctx.height_px % 2, 0, "Height must be divisible by 2");

  let max_distance_from_0 = ctx.waveform_buf[start_sample_ix as usize..end_sample_ix as usize]
    .iter()
    .fold(0.0f32, |acc, sample| acc.max(sample.abs()));
  let half_height_f32 = (ctx.height_px / 2) as f32;

  let mut last_y_ix = ctx.height_px / 2;
  for w in 0..ctx.width_px {
    let start_sample_ix = start_sample_ix + w * samples_per_px;
    let samples_indices_to_consider = start_sample_ix..(start_sample_ix + samples_per_px);

    for i in samples_indices_to_consider {
      let y_px = sample_to_y_val(
        ctx.waveform_buf[i as usize],
        half_height_f32,
        max_distance_from_0,
      );

      for y_px in last_y_ix.min(y_px)..=last_y_ix.max(y_px) {
        if let Some(cell) = ctx
          .image_data_buf
          .get_mut(((y_px * ctx.width_px + w) as usize) * BYTES_PER_PX)
        {
          *cell = 255;
        }
      }
      last_y_ix = y_px;
    }
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
