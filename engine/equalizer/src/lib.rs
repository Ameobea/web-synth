use std::ptr::addr_of_mut;

use dsp::{
  db_to_gain,
  filters::biquad::{BiquadFilter, FilterMode},
  linear_to_db_checked, FRAME_SIZE, NYQUIST, SAMPLE_RATE,
};

#[cfg(target_arch = "wasm32")]
extern "C" {
  fn log_err(ptr: *const u8, len: usize);
}

static mut DID_INIT: bool = false;

fn maybe_init() {
  unsafe {
    if DID_INIT {
      return;
    }

    DID_INIT = true;
  }

  common::set_raw_panic_hook(log_err);
}

pub enum EqualizerFilterType {
  Lowpass = 0,
  Highpass = 1,
  Bandpass = 2,
  Notch = 3,
  Peak = 4,
  Lowshelf = 5,
  Highshelf = 6,
  Allpass = 7,
  // TODO: Bell
}

impl Into<FilterMode> for EqualizerFilterType {
  fn into(self) -> FilterMode {
    match self {
      EqualizerFilterType::Lowpass => FilterMode::Lowpass,
      EqualizerFilterType::Highpass => FilterMode::Highpass,
      EqualizerFilterType::Bandpass => FilterMode::Bandpass,
      EqualizerFilterType::Notch => FilterMode::Notch,
      EqualizerFilterType::Peak => FilterMode::Peak,
      EqualizerFilterType::Lowshelf => FilterMode::Lowshelf,
      EqualizerFilterType::Highshelf => FilterMode::Highshelf,
      EqualizerFilterType::Allpass => FilterMode::Allpass,
    }
  }
}

impl EqualizerFilterType {
  fn from_usize(filter_type: usize) -> Self {
    if filter_type > 7 {
      panic!("Invalid filter type: {filter_type}");
    }
    unsafe { std::mem::transmute(filter_type as u8) }
  }
}

#[derive(Default, Clone)]
pub struct BiquadFilterParams {
  pub mode: FilterMode,
  pub q: f32,
  pub gain: f32,
  pub freq: f32,
}

pub enum EqualizerBand {
  Biquad {
    filter: BiquadFilter,
    params: BiquadFilterParams,
  },
}

impl Default for EqualizerBand {
  fn default() -> Self {
    EqualizerBand::Biquad {
      filter: BiquadFilter::default(),
      params: BiquadFilterParams::default(),
    }
  }
}

impl EqualizerBand {
  pub fn apply(&mut self, sample: f32) -> f32 {
    match self {
      EqualizerBand::Biquad { filter, .. } => filter.apply(sample),
    }
  }
}

#[derive(Default)]
pub struct ResponseBuffers {
  pub freqs: Vec<f32>,
  pub magnitudes_db: Vec<f32>,
  pub phases_rads: Vec<f32>,
}

pub struct EqualizerInst {
  pub io_buf: [f32; FRAME_SIZE],
  pub bands: Vec<EqualizerBand>,
  pub response_buffers: ResponseBuffers,
}

impl Default for EqualizerInst {
  fn default() -> Self {
    EqualizerInst {
      io_buf: [0.; FRAME_SIZE],
      bands: Vec::new(),
      response_buffers: ResponseBuffers::default(),
    }
  }
}

#[no_mangle]
pub extern "C" fn equalizer_init() -> *mut EqualizerInst {
  maybe_init();

  let ctx = Box::new(EqualizerInst::default());
  Box::into_raw(ctx)
}

#[no_mangle]
pub extern "C" fn equalizer_get_io_buf_ptr(ctx: *mut EqualizerInst) -> *mut f32 {
  let ctx = unsafe { &mut *ctx };
  addr_of_mut!(ctx.io_buf) as *mut f32
}

#[no_mangle]
pub extern "C" fn equalizer_set_band(
  ctx: *mut EqualizerInst,
  band_ix: usize,
  filter_type: usize,
  frequency: f32,
  q: f32,
  gain: f32,
) {
  let ctx = unsafe { &mut *ctx };
  while ctx.bands.len() <= band_ix {
    ctx.bands.push(EqualizerBand::default());
  }

  match &mut ctx.bands[band_ix] {
    EqualizerBand::Biquad { filter, params } => {
      let mode = EqualizerFilterType::from_usize(filter_type).into();
      filter.set_coefficients(mode, q, frequency, gain);
      params.mode = mode;
      params.q = q;
      params.freq = frequency;
      params.gain = gain;
    },
  }
}

#[no_mangle]
pub extern "C" fn equalizer_process(ctx: *mut EqualizerInst) {
  let ctx = unsafe { &mut *ctx };

  for sample in &mut ctx.io_buf {
    for band in &mut ctx.bands {
      *sample = band.apply(*sample);
    }
  }
}

#[no_mangle]
pub extern "C" fn equalizer_compute_responses(ctx: *mut EqualizerInst, grid_size: usize) {
  let ctx = unsafe { &mut *ctx };

  if ctx.bands.is_empty() {
    ctx.response_buffers.freqs.clear();
    ctx.response_buffers.magnitudes_db = vec![0.; grid_size];
    ctx.response_buffers.phases_rads = vec![0.; grid_size];

    let start_freq = 10.;
    let freq_multiplier = (NYQUIST / start_freq).powf(1. / ((grid_size - 1) as f32));
    for i in 0..grid_size {
      let freq = start_freq * freq_multiplier.powi(i as i32);
      ctx.response_buffers.freqs.push(freq);
    }
    return;
  }

  let mut responses = ctx
    .bands
    .iter()
    .map(|band| match band {
      EqualizerBand::Biquad {
        params:
          BiquadFilterParams {
            mode,
            q,
            gain,
            freq,
          },
        ..
      } =>
        BiquadFilter::compute_response_grid(*mode, *q, *freq, *gain, 10., SAMPLE_RATE, grid_size),
    })
    .collect::<Vec<_>>();

  let freqs = std::mem::take(&mut responses.first_mut().unwrap().0);
  let mut mags = std::mem::take(&mut responses.first_mut().unwrap().1);
  for mag in &mut mags {
    *mag = db_to_gain(*mag);
  }
  let mut angles = std::mem::take(&mut responses.first_mut().unwrap().2);

  for (_o_freqs, o_mags, o_angles) in &responses[1..] {
    for i in 0..mags.len() {
      let mag_linear = db_to_gain(o_mags[i]);
      mags[i] *= mag_linear;
      angles[i] += o_angles[i];
    }
  }

  // TODO: normalize angles

  for mag in &mut mags {
    *mag = linear_to_db_checked(*mag);
  }

  ctx.response_buffers.freqs = freqs;
  ctx.response_buffers.magnitudes_db = mags;
  ctx.response_buffers.phases_rads = angles;
}

#[no_mangle]
pub extern "C" fn equalizer_get_response_freqs_ptr(ctx: *const EqualizerInst) -> *const f32 {
  let ctx = unsafe { &*ctx };
  ctx.response_buffers.freqs.as_ptr() as *const f32
}

#[no_mangle]
pub extern "C" fn equalizer_get_response_mags_ptr(ctx: *const EqualizerInst) -> *const f32 {
  let ctx = unsafe { &*ctx };
  ctx.response_buffers.magnitudes_db.as_ptr() as *const f32
}

#[no_mangle]
pub extern "C" fn equalizer_get_response_phases_ptr(ctx: *const EqualizerInst) -> *const f32 {
  let ctx = unsafe { &*ctx };
  ctx.response_buffers.phases_rads.as_ptr() as *const f32
}
