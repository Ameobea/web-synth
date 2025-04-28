use dsp::{
  db_to_gain_generic,
  filters::biquad::{BiquadFilter, FilterMode},
  linear_to_db_checked, FRAME_SIZE, NYQUIST, SAMPLE_RATE,
};
use num_traits::{Float, FloatConst};

#[cfg(target_arch = "wasm32")]
extern "C" {
  fn log_err(ptr: *const u8, len: usize);
}

// This needs to be kept in sync with JS code
const MAX_AUTOMATED_PARAM_COUNT: usize = 4;

const MIN_FREQ: f64 = 10.;
const MAX_FREQ: f64 = NYQUIST as f64;
const MIN_Q: f64 = -100.;
const MAX_Q: f64 = 100.;
const MIN_GAIN: f64 = -100.;
const MAX_GAIN: f64 = 100.;

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
pub struct BiquadFilterParams<T: Float> {
  pub mode: FilterMode,
  pub q: T,
  pub gain: T,
  pub freq: T,
}

pub enum EqualizerBandInner<T: Float + FloatConst + Default> {
  Biquad {
    filter: BiquadFilter<T>,
    params: BiquadFilterParams<T>,
  },
}

impl<T: Float + FloatConst + Default> Default for EqualizerBandInner<T> {
  fn default() -> Self {
    EqualizerBandInner::Biquad {
      filter: BiquadFilter::default(),
      params: BiquadFilterParams::default(),
    }
  }
}

impl<T: Float + FloatConst + Default> EqualizerBandInner<T> {
  pub fn apply_static(&mut self, sample: T) -> T {
    match self {
      EqualizerBandInner::Biquad { filter, .. } => filter.apply(sample),
    }
  }

  pub fn apply_dynamic(&mut self, freq: T, q: T, gain: T, sample: T) -> T {
    match self {
      EqualizerBandInner::Biquad { filter, params } =>
        filter.compute_coefficients_and_apply(params.mode, q, freq, gain, sample),
    }
  }
}

pub struct NonMaxUsizeOpt(usize);

impl Default for NonMaxUsizeOpt {
  fn default() -> Self { Self::none() }
}

impl NonMaxUsizeOpt {
  fn none() -> Self { Self(usize::MAX) }

  fn is_none(&self) -> bool { self.0 == usize::MAX }

  fn as_opt(&self) -> Option<usize> {
    if self.0 == usize::MAX {
      None
    } else {
      Some(self.0)
    }
  }
}

#[derive(Default)]
pub struct EqBandParamOverrides {
  pub q: NonMaxUsizeOpt,
  pub gain: NonMaxUsizeOpt,
  pub freq: NonMaxUsizeOpt,
}

impl EqBandParamOverrides {
  pub fn is_empty(&self) -> bool { self.q.is_none() && self.gain.is_none() && self.freq.is_none() }
}

#[derive(Default)]
pub struct EqualizerBand<T: Float + FloatConst + Default> {
  pub inner: EqualizerBandInner<T>,
  pub param_overrides: EqBandParamOverrides,
}

impl<T: Float + FloatConst + Default> EqualizerBand<T> {
  fn apply(
    &mut self,
    automation_bufs: &[[f32; FRAME_SIZE]; MAX_AUTOMATED_PARAM_COUNT],
    sample: T,
    sample_ix: usize,
  ) -> T {
    if self.param_overrides.is_empty() {
      return self.inner.apply_static(sample);
    }

    let freq = if let Some(freq_ix) = self.param_overrides.freq.as_opt() {
      let raw_freq = T::from(automation_bufs[freq_ix][sample_ix]).unwrap();
      dsp::clamp(
        T::from(MIN_FREQ).unwrap(),
        T::from(MAX_FREQ).unwrap(),
        raw_freq,
      )
    } else {
      match &self.inner {
        EqualizerBandInner::Biquad { params, .. } => params.freq,
      }
    };
    let q = if let Some(q_ix) = self.param_overrides.q.as_opt() {
      let raw_q = T::from(automation_bufs[q_ix][sample_ix]).unwrap();
      dsp::clamp(T::from(MIN_Q).unwrap(), T::from(MAX_Q).unwrap(), raw_q)
    } else {
      match &self.inner {
        EqualizerBandInner::Biquad { params, .. } => params.q,
      }
    };
    let gain = if let Some(gain_ix) = self.param_overrides.gain.as_opt() {
      let raw_gain = T::from(automation_bufs[gain_ix][sample_ix]).unwrap();
      dsp::clamp(
        T::from(MIN_GAIN).unwrap(),
        T::from(MAX_GAIN).unwrap(),
        raw_gain,
      )
    } else {
      match &self.inner {
        EqualizerBandInner::Biquad { params, .. } => params.gain,
      }
    };
    return self.inner.apply_dynamic(freq, q, gain, sample);
  }
}

#[derive(Default)]
pub struct ResponseBuffers {
  pub freqs: Vec<f32>,
  pub magnitudes_db: Vec<f32>,
  pub phases_rads: Vec<f32>,
}

pub struct EqualizerInst<T: Float + FloatConst + Default> {
  pub io_buf: [f32; FRAME_SIZE],
  pub bands: Vec<EqualizerBand<T>>,
  pub response_buffers: ResponseBuffers,
  pub automation_bufs: [[f32; FRAME_SIZE]; MAX_AUTOMATED_PARAM_COUNT],
}

type EqualizerInstT = EqualizerInst<f64>;

impl<T: Float + FloatConst + Default> Default for EqualizerInst<T> {
  fn default() -> Self {
    EqualizerInst {
      io_buf: [0.; FRAME_SIZE],
      bands: Vec::new(),
      response_buffers: ResponseBuffers::default(),
      automation_bufs: [[0.; FRAME_SIZE]; MAX_AUTOMATED_PARAM_COUNT],
    }
  }
}

#[no_mangle]
pub extern "C" fn equalizer_init() -> *mut EqualizerInstT {
  maybe_init();

  let ctx = Box::new(EqualizerInst::default());
  Box::into_raw(ctx)
}

#[no_mangle]
pub extern "C" fn equalizer_get_io_buf_ptr(ctx: *mut EqualizerInstT) -> *mut f32 {
  let ctx = unsafe { &mut *ctx };
  ctx.io_buf.as_mut_ptr() as *mut f32
}

#[no_mangle]
pub extern "C" fn equalizer_get_automation_bufs_ptr(ctx: *mut EqualizerInstT) -> *mut f32 {
  let ctx = unsafe { &mut *ctx };
  ctx.automation_bufs.as_mut_ptr() as *mut f32
}

#[no_mangle]
pub extern "C" fn equalizer_set_band(
  ctx: *mut EqualizerInstT,
  band_ix: usize,
  filter_type: usize,
  frequency: f64,
  q: f64,
  gain: f64,
  freq_automation_ix: usize,
  q_automation_ix: usize,
  gain_automation_ix: usize,
) {
  let ctx = unsafe { &mut *ctx };
  while ctx.bands.len() <= band_ix {
    ctx.bands.push(EqualizerBand::default());
  }

  let band = &mut ctx.bands[band_ix];
  band.param_overrides.q = if q_automation_ix >= MAX_AUTOMATED_PARAM_COUNT {
    NonMaxUsizeOpt::none()
  } else {
    NonMaxUsizeOpt(q_automation_ix)
  };
  band.param_overrides.gain = if gain_automation_ix >= MAX_AUTOMATED_PARAM_COUNT {
    NonMaxUsizeOpt::none()
  } else {
    NonMaxUsizeOpt(gain_automation_ix)
  };
  band.param_overrides.freq = if freq_automation_ix >= MAX_AUTOMATED_PARAM_COUNT {
    NonMaxUsizeOpt::none()
  } else {
    NonMaxUsizeOpt(freq_automation_ix)
  };

  match &mut band.inner {
    EqualizerBandInner::Biquad { filter, params } => {
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
pub extern "C" fn equalizer_set_band_count(ctx: *mut EqualizerInstT, band_count: usize) {
  let ctx = unsafe { &mut *ctx };
  ctx
    .bands
    .resize_with(band_count, || EqualizerBand::default());
}

#[no_mangle]
pub extern "C" fn equalizer_process(ctx: *mut EqualizerInstT) {
  let ctx = unsafe { &mut *ctx };

  for (sample_ix, sample_ref) in ctx.io_buf.iter_mut().enumerate() {
    let mut sample = *sample_ref as f64;
    for band in &mut ctx.bands {
      sample = band.apply(&ctx.automation_bufs, sample, sample_ix);
    }
    *sample_ref = sample as f32;
  }
}

#[no_mangle]
pub extern "C" fn equalizer_compute_responses(ctx: *mut EqualizerInstT, grid_size: usize) {
  let ctx = unsafe { &mut *ctx };

  if ctx.bands.is_empty() {
    ctx.response_buffers.freqs.clear();
    ctx.response_buffers.magnitudes_db = vec![0.; grid_size];
    ctx.response_buffers.phases_rads = vec![0.; grid_size];

    let start_freq = 10.;
    let freq_multiplier = (NYQUIST as f64 / start_freq).powf(1. / ((grid_size - 1) as f64));
    for i in 0..grid_size {
      let freq = start_freq * freq_multiplier.powi(i as i32);
      ctx.response_buffers.freqs.push(freq as f32);
    }
    return;
  }

  let mut responses = ctx
    .bands
    .iter()
    .map(|band| match &band.inner {
      EqualizerBandInner::Biquad {
        params:
          BiquadFilterParams {
            mode,
            q,
            gain,
            freq,
          },
        ..
      } => {
        let maybe_automated_q = match band.param_overrides.q.as_opt() {
          Some(q_ix) => ctx.automation_bufs[q_ix][0] as f64,
          None => *q,
        };
        let maybe_automated_freq = match band.param_overrides.freq.as_opt() {
          Some(freq_ix) => ctx.automation_bufs[freq_ix][0] as f64,
          None => *freq,
        };
        let maybe_automated_gain = match band.param_overrides.gain.as_opt() {
          Some(gain_ix) => ctx.automation_bufs[gain_ix][0] as f64,
          None => *gain,
        };

        BiquadFilter::compute_response_grid(
          *mode,
          maybe_automated_q,
          maybe_automated_freq,
          maybe_automated_gain,
          10.,
          SAMPLE_RATE as f64,
          grid_size,
        )
      },
    })
    .collect::<Vec<_>>();

  let freqs = std::mem::take(&mut responses.first_mut().unwrap().0);
  let mut mags = std::mem::take(&mut responses.first_mut().unwrap().1);
  for mag in &mut mags {
    *mag = db_to_gain_generic(*mag);
  }
  let mut angles = std::mem::take(&mut responses.first_mut().unwrap().2);

  for (_o_freqs, o_mags, o_angles) in &responses[1..] {
    for i in 0..mags.len() {
      let mag_linear = db_to_gain_generic(o_mags[i]);
      mags[i] *= mag_linear;
      angles[i] += o_angles[i];
    }
  }

  // TODO: normalize angles

  for mag in &mut mags {
    *mag = linear_to_db_checked(*mag);
  }

  ctx.response_buffers.freqs = freqs.into_iter().map(|x| x as f32).collect();
  ctx.response_buffers.magnitudes_db = mags.into_iter().map(|x| x as f32).collect();
  ctx.response_buffers.phases_rads = angles.into_iter().map(|x| x as f32).collect();
}

#[no_mangle]
pub extern "C" fn equalizer_get_response_freqs_ptr(ctx: *const EqualizerInstT) -> *const f32 {
  let ctx = unsafe { &*ctx };
  ctx.response_buffers.freqs.as_ptr() as *const f32
}

#[no_mangle]
pub extern "C" fn equalizer_get_response_mags_ptr(ctx: *const EqualizerInstT) -> *const f32 {
  let ctx = unsafe { &*ctx };
  ctx.response_buffers.magnitudes_db.as_ptr() as *const f32
}

#[no_mangle]
pub extern "C" fn equalizer_get_response_phases_ptr(ctx: *const EqualizerInstT) -> *const f32 {
  let ctx = unsafe { &*ctx };
  ctx.response_buffers.phases_rads.as_ptr() as *const f32
}
