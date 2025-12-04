use std::ops::{AddAssign, MulAssign};

use dsp::{
  filters::{
    biquad::{BiquadFilter, ComputeGridFilterParams, FilterMode},
    dynabandpass::DynabandpassFilter,
  },
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

const DYNABANDPASS_MIN_BANDWIDTH: f64 = 5.;
const DYNABANDPASS_MAX_BANDWIDTH: f64 = 10_000.;

/// Converts Q (in dB, in [-50, 25]) to bandwidth (in Hz, in [5, 10_000]).
/// Higher Q -> narrower bandwidth. The mapping is logarithmic.
fn dynabandpass_q_to_bandwidth(q: f64) -> f64 {
  let q_clamped = q.clamp(-50., 25.);
  DYNABANDPASS_MIN_BANDWIDTH
    * (DYNABANDPASS_MAX_BANDWIDTH / DYNABANDPASS_MIN_BANDWIDTH).powf((25. - q_clamped) / 75.0)
}

static mut DID_INIT: bool = false;

fn maybe_init() {
  unsafe {
    if DID_INIT {
      return;
    }

    DID_INIT = true;
  }

  #[cfg(target_arch = "wasm32")]
  common::set_raw_panic_hook(log_err);
}

#[derive(Debug, Clone, Copy)]
pub enum EqualizerFilterType {
  Lowpass = 0,
  Highpass = 1,
  Bandpass = 2,
  Notch = 3,
  Peak = 4,
  Lowshelf = 5,
  Highshelf = 6,
  Allpass = 7,
  Order4Lowpass = 8,
  Order8Lowpass = 9,
  Order16Lowpass = 10,
  Order4Highpass = 11,
  Order8Highpass = 12,
  Order16Highpass = 13,
  Dynabandpass = 14,
}

impl EqualizerFilterType {
  pub fn get_lower_order_mode(&self) -> FilterMode {
    match self {
      EqualizerFilterType::Lowpass => FilterMode::Lowpass,
      EqualizerFilterType::Highpass => FilterMode::Highpass,
      EqualizerFilterType::Bandpass => FilterMode::Bandpass,
      EqualizerFilterType::Notch => FilterMode::Notch,
      EqualizerFilterType::Peak => FilterMode::Peak,
      EqualizerFilterType::Lowshelf => FilterMode::Lowshelf,
      EqualizerFilterType::Highshelf => FilterMode::Highshelf,
      EqualizerFilterType::Allpass => FilterMode::Allpass,
      EqualizerFilterType::Order4Lowpass => FilterMode::Lowpass,
      EqualizerFilterType::Order8Lowpass => FilterMode::Lowpass,
      EqualizerFilterType::Order16Lowpass => FilterMode::Lowpass,
      EqualizerFilterType::Order4Highpass => FilterMode::Highpass,
      EqualizerFilterType::Order8Highpass => FilterMode::Highpass,
      EqualizerFilterType::Order16Highpass => FilterMode::Highpass,
      EqualizerFilterType::Dynabandpass => FilterMode::Bandpass,
    }
  }
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
      _ => panic!("Invalid filter type: {self:?}"),
    }
  }
}

impl EqualizerFilterType {
  fn from_usize(filter_type: usize) -> Self {
    if filter_type > 14 {
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
  Biquad4 {
    filter: [BiquadFilter<T>; 2],
    params: BiquadFilterParams<T>,
  },
  Biquad8 {
    filter: [BiquadFilter<T>; 4],
    params: BiquadFilterParams<T>,
  },
  Biquad16 {
    filter: [BiquadFilter<T>; 8],
    params: BiquadFilterParams<T>,
  },
  Dynabandpass {
    filter: DynabandpassFilter,
    center_freq: T,
    bandwidth: T,
  },
}

impl<T: Float + FloatConst + Default> EqualizerBandInner<T> {
  pub fn get_params(&self) -> &BiquadFilterParams<T> {
    match self {
      EqualizerBandInner::Biquad { params, .. } => params,
      EqualizerBandInner::Biquad4 { params, .. } => params,
      EqualizerBandInner::Biquad8 { params, .. } => params,
      EqualizerBandInner::Biquad16 { params, .. } => params,
      EqualizerBandInner::Dynabandpass { .. } => {
        panic!("get_params() called on Dynabandpass filter; use `get_dynabandpass_params` instead")
      },
    }
  }

  pub fn get_dynabandpass_params(&self) -> Option<(T, T)> {
    match self {
      EqualizerBandInner::Dynabandpass {
        center_freq,
        bandwidth,
        ..
      } => Some((*center_freq, *bandwidth)),
      _ => None,
    }
  }
}

impl<T: Float + FloatConst + Default> Default for EqualizerBandInner<T> {
  fn default() -> Self {
    EqualizerBandInner::Biquad {
      filter: BiquadFilter::default(),
      params: BiquadFilterParams::default(),
    }
  }
}

// computed with `compute_higher_order_biquad_q_factors`, converted to dB from linear values
const ORDER_4_Q_FACTORS: [f64; 2] = [-5.332906831698536, 2.3226068750587237];
const ORDER_8_Q_FACTORS: [f64; 4] = [
  -5.852078700167258,
  -4.417527547217123,
  -0.9153792844814148,
  8.174685575225983,
];
const ORDER_16_Q_FACTORS: [f64; 8] = [
  -5.978673956900887,
  -5.638297129212715,
  -4.929196196746187,
  -3.7843072510784115,
  -2.0677714490888492,
  0.5116686495290655,
  4.722917844731299,
  14.15335953212686,
];

fn apply_filter_chain<T: Float + FloatConst + Default + MulAssign + AddAssign, const LEN: usize>(
  filter_chain: &mut [BiquadFilter<T>; LEN],
  mut sample: T,
) -> T {
  for filter in filter_chain {
    sample = filter.apply(sample);
  }
  sample
}

fn apply_filter_chain_dynamic<
  T: Float + FloatConst + Default + MulAssign + AddAssign,
  const LEN: usize,
>(
  mode: FilterMode,
  filter_chain: &mut [BiquadFilter<T>; LEN],
  base_qs: &[f64; LEN],
  q_offset: T,
  freq: T,
  gain: T,
  mut sample: T,
) -> T {
  for (filter_ix, filter) in filter_chain.iter_mut().enumerate() {
    let q = T::from(base_qs[filter_ix]).unwrap() + q_offset / T::from(LEN).unwrap();
    let coeffs = BiquadFilter::compute_coefficients(mode, q, freq, gain);
    sample =
      filter.apply_with_coefficients(sample, coeffs.0, coeffs.1, coeffs.2, coeffs.3, coeffs.4);
  }
  sample
}

impl<T: Float + FloatConst + Default + MulAssign + AddAssign> EqualizerBandInner<T> {
  pub fn apply_static(&mut self, sample: T) -> T {
    match self {
      EqualizerBandInner::Biquad { filter, .. } => filter.apply(sample),
      EqualizerBandInner::Biquad4 { filter, .. } => apply_filter_chain(filter, sample),
      EqualizerBandInner::Biquad8 { filter, .. } => apply_filter_chain(filter, sample),
      EqualizerBandInner::Biquad16 { filter, .. } => apply_filter_chain(filter, sample),
      EqualizerBandInner::Dynabandpass {
        filter,
        center_freq,
        bandwidth,
      } => {
        let center_freq_f32 = center_freq.to_f32().unwrap_or(1000.0);
        let bandwidth_f32 = bandwidth.to_f32().unwrap_or(100.0);
        let sample_f32 = sample.to_f32().unwrap_or(0.0);
        let result = filter.apply_single(sample_f32, center_freq_f32, bandwidth_f32);
        T::from(result).unwrap()
      },
    }
  }

  pub fn apply_dynamic(&mut self, freq: T, q: T, gain: T, sample: T) -> T {
    match self {
      EqualizerBandInner::Biquad { filter, params } => {
        let coeffs = BiquadFilter::compute_coefficients(params.mode, q, freq, gain);
        filter.apply_with_coefficients(sample, coeffs.0, coeffs.1, coeffs.2, coeffs.3, coeffs.4)
      },
      EqualizerBandInner::Biquad4 { filter, params } => apply_filter_chain_dynamic(
        params.mode,
        filter,
        &ORDER_4_Q_FACTORS,
        q,
        freq,
        gain,
        sample,
      ),
      EqualizerBandInner::Biquad8 { filter, params } => apply_filter_chain_dynamic(
        params.mode,
        filter,
        &ORDER_8_Q_FACTORS,
        q,
        freq,
        gain,
        sample,
      ),
      EqualizerBandInner::Biquad16 { filter, params } => apply_filter_chain_dynamic(
        params.mode,
        filter,
        &ORDER_16_Q_FACTORS,
        q,
        freq,
        gain,
        sample,
      ),
      EqualizerBandInner::Dynabandpass { filter, .. } => {
        let q_f64 = q.to_f64().unwrap_or(0.0);
        let bandwidth_hz = dynabandpass_q_to_bandwidth(q_f64);
        let center_freq_f32 = freq.to_f32().unwrap_or(1000.0);
        let bandwidth_f32 = bandwidth_hz as f32;
        let sample_f32 = sample.to_f32().unwrap_or(0.0);
        let result = filter.apply_single(sample_f32, center_freq_f32, bandwidth_f32);
        T::from(result).unwrap()
      },
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

impl<T: Float + FloatConst + Default + MulAssign + AddAssign> EqualizerBand<T> {
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
      self.inner.get_params().freq
    };
    let q = if let Some(q_ix) = self.param_overrides.q.as_opt() {
      let raw_q = T::from(automation_bufs[q_ix][sample_ix]).unwrap();
      dsp::clamp(T::from(MIN_Q).unwrap(), T::from(MAX_Q).unwrap(), raw_q)
    } else {
      self.inner.get_params().q
    };
    let gain = if let Some(gain_ix) = self.param_overrides.gain.as_opt() {
      let raw_gain = T::from(automation_bufs[gain_ix][sample_ix]).unwrap();
      dsp::clamp(
        T::from(MIN_GAIN).unwrap(),
        T::from(MAX_GAIN).unwrap(),
        raw_gain,
      )
    } else {
      self.inner.get_params().gain
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

  fn set_chain_params<T: Float + FloatConst + Default + MulAssign + AddAssign, const LEN: usize>(
    filter_chain: &mut [BiquadFilter<T>; LEN],
    params: &mut BiquadFilterParams<T>,
    mode: FilterMode,
    base_qs: &[T; LEN],
    q_offset: T,
    frequency: T,
    gain: T,
  ) {
    for (filter_ix, filter) in filter_chain.iter_mut().enumerate() {
      let q = base_qs[filter_ix] + q_offset / T::from(LEN).unwrap();
      filter.set_coefficients(mode, q, frequency, gain);
    }

    params.mode = mode;
    params.q = q_offset;
    params.freq = frequency;
    params.gain = gain;
  }

  let filter_type = EqualizerFilterType::from_usize(filter_type);
  match filter_type {
    EqualizerFilterType::Lowpass
    | EqualizerFilterType::Highpass
    | EqualizerFilterType::Bandpass
    | EqualizerFilterType::Notch
    | EqualizerFilterType::Peak
    | EqualizerFilterType::Lowshelf
    | EqualizerFilterType::Highshelf
    | EqualizerFilterType::Allpass => {
      let (filter, params) = if let EqualizerBandInner::Biquad { filter, params } = &mut band.inner
      {
        (filter, params)
      } else {
        band.inner = EqualizerBandInner::Biquad {
          filter: BiquadFilter::default(),
          params: BiquadFilterParams::default(),
        };
        if let EqualizerBandInner::Biquad { filter, params } = &mut band.inner {
          (filter, params)
        } else {
          unreachable!()
        }
      };

      let mode = filter_type.into();
      filter.set_coefficients(mode, q, frequency, gain);
      params.mode = mode;
      params.q = q;
      params.freq = frequency;
      params.gain = gain;
    },
    EqualizerFilterType::Order4Lowpass | EqualizerFilterType::Order4Highpass => {
      let (filter_chain, params) =
        if let EqualizerBandInner::Biquad4 { filter, params } = &mut band.inner {
          (filter, params)
        } else {
          band.inner = EqualizerBandInner::Biquad4 {
            filter: [BiquadFilter::default(); 2],
            params: BiquadFilterParams::default(),
          };
          if let EqualizerBandInner::Biquad4 { filter, params } = &mut band.inner {
            (filter, params)
          } else {
            unreachable!()
          }
        };

      set_chain_params(
        filter_chain,
        params,
        filter_type.get_lower_order_mode(),
        &ORDER_4_Q_FACTORS,
        q,
        frequency,
        gain,
      );
    },
    EqualizerFilterType::Order8Lowpass | EqualizerFilterType::Order8Highpass => {
      let (filter_chain, params) =
        if let EqualizerBandInner::Biquad8 { filter, params } = &mut band.inner {
          (filter, params)
        } else {
          band.inner = EqualizerBandInner::Biquad8 {
            filter: [BiquadFilter::default(); 4],
            params: BiquadFilterParams::default(),
          };
          if let EqualizerBandInner::Biquad8 { filter, params } = &mut band.inner {
            (filter, params)
          } else {
            unreachable!()
          }
        };

      set_chain_params(
        filter_chain,
        params,
        filter_type.get_lower_order_mode(),
        &ORDER_8_Q_FACTORS,
        q,
        frequency,
        gain,
      );
    },
    EqualizerFilterType::Order16Lowpass | EqualizerFilterType::Order16Highpass => {
      let (filter_chain, params) =
        if let EqualizerBandInner::Biquad16 { filter, params } = &mut band.inner {
          (filter, params)
        } else {
          band.inner = EqualizerBandInner::Biquad16 {
            filter: [BiquadFilter::default(); 8],
            params: BiquadFilterParams::default(),
          };
          if let EqualizerBandInner::Biquad16 { filter, params } = &mut band.inner {
            (filter, params)
          } else {
            unreachable!()
          }
        };

      set_chain_params(
        filter_chain,
        params,
        filter_type.get_lower_order_mode(),
        &ORDER_16_Q_FACTORS,
        q,
        frequency,
        gain,
      );
    },
    EqualizerFilterType::Dynabandpass => {
      let bandwidth_hz = dynabandpass_q_to_bandwidth(q);

      if !matches!(band.inner, EqualizerBandInner::Dynabandpass { .. }) {
        band.inner = EqualizerBandInner::Dynabandpass {
          filter: DynabandpassFilter::new(bandwidth_hz as f32),
          center_freq: frequency,
          bandwidth: bandwidth_hz,
        };
      } else if let EqualizerBandInner::Dynabandpass {
        filter,
        center_freq,
        bandwidth,
      } = &mut band.inner
      {
        *center_freq = frequency;
        *bandwidth = bandwidth_hz;
        filter.set_bandwidth(bandwidth_hz as f32);
      }
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

fn compute_chain_response<
  T: Float + FloatConst + Default + MulAssign + AddAssign,
  O: Float + MulAssign + AddAssign,
  const LEN: usize,
>(
  mode: FilterMode,
  base_qs: &[T; LEN],
  q_offset: T,
  freq: T,
  gain: T,
  grid_size: usize,
) -> (Vec<O>, Vec<O>, Vec<O>) {
  BiquadFilter::compute_chain_response_grid(
    mode,
    std::array::from_fn::<ComputeGridFilterParams<T>, LEN, _>(|i| ComputeGridFilterParams {
      q: base_qs[i] + q_offset / T::from(LEN).unwrap(),
      cutoff_freq: freq,
      gain,
    }),
    T::from(10.).unwrap(),
    T::from(SAMPLE_RATE).unwrap(),
    grid_size,
  )
}

#[no_mangle]
pub extern "C" fn equalizer_compute_responses(
  ctx: *mut EqualizerInstT,
  grid_size: usize,
  use_automated_params: bool,
) {
  let ctx = unsafe { &mut *ctx };

  if ctx.bands.is_empty() {
    ctx.response_buffers.freqs.clear();
    ctx.response_buffers.magnitudes_db.resize(grid_size, 0.);
    ctx.response_buffers.magnitudes_db.fill(0.);
    ctx.response_buffers.phases_rads.resize(grid_size, 0.);
    ctx.response_buffers.phases_rads.fill(0.);

    let start_freq = 10.;
    let freq_multiplier = (NYQUIST as f64 / start_freq).powf(1. / ((grid_size - 1) as f64));
    for i in 0..grid_size {
      let freq = start_freq * freq_multiplier.powi(i as i32);
      ctx.response_buffers.freqs.push(freq as f32);
    }
    return;
  }

  let mut responses = ctx.bands.iter().map(|band| {
    match &band.inner {
      EqualizerBandInner::Dynabandpass {
        center_freq,
        bandwidth,
        ..
      } => {
        let maybe_automated_freq = match band.param_overrides.freq.as_opt() {
          Some(freq_ix) if use_automated_params => ctx.automation_bufs[freq_ix][0] as f64,
          _ => *center_freq,
        };
        let maybe_automated_bandwidth = match band.param_overrides.q.as_opt() {
          Some(q_ix) if use_automated_params => {
            let q_db = ctx.automation_bufs[q_ix][0] as f64;
            dynabandpass_q_to_bandwidth(q_db)
          },
          _ => *bandwidth,
        };

        DynabandpassFilter::compute_response_grid::<f32>(
          maybe_automated_freq as f32,
          maybe_automated_bandwidth as f32,
          10.,
          SAMPLE_RATE,
          grid_size,
        )
      },
      _ => {
        let mode = band.inner.get_params().mode;
        let maybe_automated_q = match band.param_overrides.q.as_opt() {
          Some(q_ix) if use_automated_params => ctx.automation_bufs[q_ix][0] as f64,
          _ => band.inner.get_params().q,
        };
        let maybe_automated_freq = match band.param_overrides.freq.as_opt() {
          Some(freq_ix) if use_automated_params => ctx.automation_bufs[freq_ix][0] as f64,
          _ => band.inner.get_params().freq,
        };
        let maybe_automated_gain = match band.param_overrides.gain.as_opt() {
          Some(gain_ix) if use_automated_params => ctx.automation_bufs[gain_ix][0] as f64,
          _ => band.inner.get_params().gain,
        };

        match &band.inner {
          EqualizerBandInner::Biquad { .. } => BiquadFilter::compute_response_grid::<f32>(
            mode,
            maybe_automated_q,
            maybe_automated_freq,
            maybe_automated_gain,
            10.,
            SAMPLE_RATE as f64,
            grid_size,
          ),
          EqualizerBandInner::Biquad4 { .. } => compute_chain_response(
            mode,
            &ORDER_4_Q_FACTORS,
            maybe_automated_q,
            maybe_automated_freq,
            maybe_automated_gain,
            grid_size,
          ),
          EqualizerBandInner::Biquad8 { .. } => compute_chain_response(
            mode,
            &ORDER_8_Q_FACTORS,
            maybe_automated_q,
            maybe_automated_freq,
            maybe_automated_gain,
            grid_size,
          ),
          EqualizerBandInner::Biquad16 { .. } => compute_chain_response(
            mode,
            &ORDER_16_Q_FACTORS,
            maybe_automated_q,
            maybe_automated_freq,
            maybe_automated_gain,
            grid_size,
          ),
          EqualizerBandInner::Dynabandpass { .. } => unreachable!(),
        }
      },
    }
  });

  let (freqs, mut mags, mut angles) = responses.next().unwrap();

  for (_o_freqs, o_mags, o_angles) in responses {
    for i in 0..mags.len() {
      mags[i] *= o_mags[i];
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
