use std::mem::MaybeUninit;

use dsp::{
  filters::biquad::{BiquadFilter, BiquadFilterBank2D, FilterMode},
  FRAME_SIZE,
};

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
  fn log_err(ptr: *const u8, len: usize);
}

#[cfg(not(target_arch = "wasm32"))]
extern "C" fn log_err(ptr: *const u8, len: usize) {
  let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
  let s = std::str::from_utf8(slice).unwrap();
  eprintln!("{}", s);
}

const SAMPLE_RATE: usize = 44_100;
const BAND_ORDER: usize = 16; // 24;
const BAND_COUNT: usize = 22; // 36;
const FILTERS_PER_BAND: usize = BAND_ORDER;

pub struct VocoderBand {
  pub filters: [BiquadFilter; FILTERS_PER_BAND],
}

impl VocoderBand {
  pub fn process(&mut self, input: f32) -> f32 {
    let mut output = input;
    for filter in self.filters.iter_mut() {
      output = filter.apply(output);
    }
    output
  }
}

fn one_pole_coeff(tau_s: f32) -> f32 { (-1. / (SAMPLE_RATE as f32 * tau_s)).exp() }

/// Two-stage envelope follower: attack/release one-pole on |x|, then a short smoothing pole to
/// suppress residual ripple at 2*f_band which would otherwise ring-modulate the carrier.  Time
/// constants scale with band center frequency, clamped so low bands stay responsive and high
/// bands stay smooth.
pub struct LevelDetectionBand {
  attack_coeff: f32,
  release_coeff: f32,
  smooth_coeff: f32,
  ar_state: f32,
  smooth_state: f32,
}

impl LevelDetectionBand {
  fn new(band_center_freq_hz: f32) -> Self {
    let attack_tau = (0.5 / band_center_freq_hz).clamp(0.001, 0.012);
    let release_tau = (4. / band_center_freq_hz).clamp(0.02, 0.08);
    let smooth_tau = (0.5 / band_center_freq_hz).clamp(0.0003, 0.006);
    LevelDetectionBand {
      attack_coeff: one_pole_coeff(attack_tau),
      release_coeff: one_pole_coeff(release_tau),
      smooth_coeff: one_pole_coeff(smooth_tau),
      ar_state: 0.,
      smooth_state: 0.,
    }
  }

  pub fn process(&mut self, sample: f32) -> f32 {
    let x = sample.abs();
    let coeff = if x > self.ar_state {
      self.attack_coeff
    } else {
      self.release_coeff
    };
    self.ar_state = coeff * self.ar_state + (1. - coeff) * x;
    self.smooth_state =
      self.smooth_coeff * self.smooth_state + (1. - self.smooth_coeff) * self.ar_state;
    if self.smooth_state < 1e-10 && x == 0. {
      self.ar_state = 0.;
      self.smooth_state = 0.;
    }
    self.smooth_state
  }
}

pub struct LevelDetectionCtx {
  pub bands: [LevelDetectionBand; BAND_COUNT],
}

impl LevelDetectionCtx {
  fn new(band_center_freqs_hz: &[f32]) -> Self {
    Self {
      bands: std::array::from_fn(|band_ix| LevelDetectionBand::new(band_center_freqs_hz[band_ix])),
    }
  }
}

pub struct VocoderCtx {
  pub carrier_input_buf: [f32; FRAME_SIZE],
  pub carrier_filter_bands: Box<[VocoderBand; BAND_COUNT]>,
  pub carrier_filter_bands_simd: Box<BiquadFilterBank2D<BAND_COUNT, FILTERS_PER_BAND>>,
  pub modulator_input_buf: [f32; FRAME_SIZE],
  pub modulator_filter_bands: Box<[VocoderBand; BAND_COUNT]>,
  pub modulator_filter_bands_simd: Box<BiquadFilterBank2D<BAND_COUNT, FILTERS_PER_BAND>>,
  pub modulator_level_detection_ctx: LevelDetectionCtx,
  pub output_buf: [f32; FRAME_SIZE],
  pub carrier_gain: f32,
  pub modulator_gain: f32,
  pub output_gain: f32,
}

// Need two params per filter: cutoff and Q
const FILTER_PARAMS_BUF_LEN: usize = BAND_COUNT * FILTERS_PER_BAND * 2;
pub static mut FILTER_PARAMS_BUF: [f32; FILTER_PARAMS_BUF_LEN] = [0.; FILTER_PARAMS_BUF_LEN];

#[no_mangle]
pub extern "C" fn get_filter_params_buf_ptr() -> *mut f32 { &raw mut FILTER_PARAMS_BUF as *mut _ }

#[inline(always)]
fn uninit<T>() -> T { unsafe { MaybeUninit::uninit().assume_init() } }

impl VocoderCtx {
  #[cold]
  fn build_filter_bands() -> Box<[VocoderBand; BAND_COUNT]> {
    let mut bands: Box<MaybeUninit<[VocoderBand; BAND_COUNT]>> = Box::new_uninit();
    let bands_ptr = bands.as_mut_ptr() as *mut VocoderBand;
    for band_ix in 0..BAND_COUNT {
      let mut band = MaybeUninit::<VocoderBand>::uninit();
      let band_ptr = band.as_mut_ptr() as *mut BiquadFilter;
      for filter_ix in 0..FILTERS_PER_BAND {
        let filter_type = if filter_ix < FILTERS_PER_BAND / 2 {
          FilterMode::Lowpass
        } else {
          FilterMode::Highpass
        };
        unsafe {
          let cutoff_freq = FILTER_PARAMS_BUF[(FILTERS_PER_BAND * band_ix + filter_ix) * 2];
          let q = FILTER_PARAMS_BUF[(FILTERS_PER_BAND * band_ix + filter_ix) * 2 + 1];
          let filter = BiquadFilter::new(filter_type, q, cutoff_freq, 0.);
          band_ptr.add(filter_ix).write(filter)
        };
      }
      unsafe { bands_ptr.add(band_ix).write(band.assume_init()) };
    }
    unsafe { bands.assume_init() }
  }

  pub fn new() -> Self {
    let mut band_center_freqs_hz = [0.; BAND_COUNT];
    for band_ix in 0..BAND_COUNT {
      let lowpass_freq =
        unsafe { FILTER_PARAMS_BUF[(FILTERS_PER_BAND * band_ix + FILTERS_PER_BAND / 2 - 1) * 2] };
      let highpass_freq =
        unsafe { FILTER_PARAMS_BUF[(FILTERS_PER_BAND * band_ix + FILTERS_PER_BAND / 2) * 2] };
      band_center_freqs_hz[band_ix] = (lowpass_freq + highpass_freq) / 2.;
    }

    let carrier_filter_bands = Self::build_filter_bands();
    let modulator_filter_bands = Self::build_filter_bands();

    let mut filter_bands_for_simd: [[BiquadFilter; BAND_COUNT]; FILTERS_PER_BAND] = uninit();

    for filter_ix in 0..FILTERS_PER_BAND {
      for band_ix in 0..BAND_COUNT {
        unsafe {
          std::ptr::write(
            &mut filter_bands_for_simd[filter_ix][band_ix],
            carrier_filter_bands[band_ix].filters[filter_ix],
          )
        }
      }
    }
    let carrier_filter_bands_simd = Box::new(BiquadFilterBank2D::new(&filter_bands_for_simd));

    for filter_ix in 0..FILTERS_PER_BAND {
      for band_ix in 0..BAND_COUNT {
        unsafe {
          std::ptr::write(
            &mut filter_bands_for_simd[filter_ix][band_ix],
            modulator_filter_bands[band_ix].filters[filter_ix],
          )
        }
      }
    }
    let modulator_filter_bands_simd = Box::new(BiquadFilterBank2D::new(&filter_bands_for_simd));

    Self {
      carrier_input_buf: [0.; FRAME_SIZE],
      carrier_filter_bands,
      carrier_filter_bands_simd,
      modulator_input_buf: [0.; FRAME_SIZE],
      modulator_filter_bands,
      modulator_level_detection_ctx: LevelDetectionCtx::new(&band_center_freqs_hz),
      modulator_filter_bands_simd,
      output_buf: [0.; FRAME_SIZE],
      carrier_gain: 1.,
      modulator_gain: 1.,
      output_gain: 1.,
    }
  }

  /// First, we pass the modulator through the modulator bands and detect the level of each band.
  ///
  /// Then, we pass the carrier through the carrier bands and multiply the output of each band by
  /// the level of the corresponding modulator band.
  ///
  /// Filters in each band are processed in series.  Bands are processed in parallel.
  #[cfg(not(target_arch = "wasm32"))]
  pub fn process(&mut self, carrier_gain: f32, modulator_gain: f32, post_gain: f32) {
    let carrier_gain = dsp::smooth(&mut self.carrier_gain, carrier_gain, 0.5);
    let modulator_gain = dsp::smooth(&mut self.modulator_gain, modulator_gain, 0.5);
    let post_gain = dsp::smooth(&mut self.output_gain, post_gain, 0.5);

    self.output_buf.fill(0.);

    for band_ix in 0..BAND_COUNT {
      let level_detector = &mut self.modulator_level_detection_ctx.bands[band_ix];
      let carrier_band = &mut self.carrier_filter_bands[band_ix];
      let modulator_band = &mut self.modulator_filter_bands[band_ix];
      for sample_ix in 0..FRAME_SIZE {
        let modulator_band_output =
          modulator_band.process(self.modulator_input_buf[sample_ix] * modulator_gain);
        let level = level_detector.process(modulator_band_output);
        if cfg!(debug_assertions) && (level.is_infinite() || level.is_nan()) {
          panic!("{}", level);
        }

        let carrier_band_output =
          carrier_band.process(self.carrier_input_buf[sample_ix] * carrier_gain);

        self.output_buf[sample_ix] += carrier_band_output * level;
      }
    }

    for sample_ix in 0..FRAME_SIZE {
      self.output_buf[sample_ix] *= post_gain;
    }
  }

  #[cfg(target_arch = "wasm32")]
  pub fn process(&mut self, carrier_gain: f32, modulator_gain: f32, post_gain: f32) {
    let carrier_gain = dsp::smooth(&mut self.carrier_gain, carrier_gain, 0.5);
    let modulator_gain = dsp::smooth(&mut self.modulator_gain, modulator_gain, 0.5);
    let post_gain = dsp::smooth(&mut self.output_gain, post_gain, 0.5);

    self.output_buf.fill(0.);

    let mut modulator_outputs: [f32; BAND_COUNT] = [0.; BAND_COUNT];
    let mut carrier_outputs: [f32; BAND_COUNT] = [0.; BAND_COUNT];

    for sample_ix in 0..FRAME_SIZE {
      modulator_outputs.fill(self.modulator_input_buf[sample_ix] * modulator_gain);
      carrier_outputs.fill(self.carrier_input_buf[sample_ix] * carrier_gain);

      for depth in 0..FILTERS_PER_BAND {
        self
          .modulator_filter_bands_simd
          .apply_simd(&mut modulator_outputs, depth);

        self
          .carrier_filter_bands_simd
          .apply_simd(&mut carrier_outputs, depth);
      }

      for band_ix in 0..BAND_COUNT {
        let sample = modulator_outputs[band_ix];
        let level = self.modulator_level_detection_ctx.bands[band_ix].process(sample);
        if cfg!(debug_assertions) && (level.is_infinite() || level.is_nan()) {
          panic!("{}", level);
        }

        self.output_buf[sample_ix] += carrier_outputs[band_ix] * level;
      }
    }

    for sample_ix in 0..FRAME_SIZE {
      self.output_buf[sample_ix] *= post_gain;
    }
  }
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

#[no_mangle]
pub extern "C" fn vocoder_create_ctx() -> *mut VocoderCtx {
  maybe_init();

  Box::into_raw(Box::new(VocoderCtx::new()))
}

#[no_mangle]
pub extern "C" fn vocoder_get_carrier_input_buf_ptr(ctx: *mut VocoderCtx) -> *mut f32 {
  unsafe { (*ctx).carrier_input_buf.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn vocoder_get_modulator_input_buf_ptr(ctx: *mut VocoderCtx) -> *mut f32 {
  unsafe { (*ctx).modulator_input_buf.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn vocoder_get_output_buf_ptr(ctx: *mut VocoderCtx) -> *mut f32 {
  unsafe { (*ctx).output_buf.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn vocoder_process(
  ctx: *mut VocoderCtx,
  carrier_gain: f32,
  modulator_gain: f32,
  output_gain: f32,
) {
  let ctx = unsafe { &mut *ctx };
  ctx.process(carrier_gain, modulator_gain, output_gain);
}

#[test]
fn envelope_follower_dynamics() {
  let f_c = 1000.;
  let mut det = LevelDetectionBand::new(f_c);

  let mut level = 0.;
  for i in 0..SAMPLE_RATE {
    let s = (i as f32 / SAMPLE_RATE as f32 * f_c * std::f32::consts::TAU).sin();
    level = det.process(s);
  }
  assert!(level > 0.5 && level < 1.05, "{level}");

  for _ in 0..SAMPLE_RATE {
    level = det.process(0.);
  }
  assert_eq!(level, 0.);
}

#[test]
fn envelope_follower_ripple() {
  // ripple on a steady high-band sine must stay small; the old windowed-RMS detector had ~10%
  // ripple here which ring-modulated the carrier
  let f_c = 9000.;
  let mut det = LevelDetectionBand::new(f_c);
  let (mut min, mut max) = (f32::MAX, 0f32);
  for i in 0..SAMPLE_RATE * 2 {
    let s = (i as f32 / SAMPLE_RATE as f32 * f_c * std::f32::consts::TAU).sin();
    let level = det.process(s);
    if i > SAMPLE_RATE {
      min = min.min(level);
      max = max.max(level);
    }
  }
  assert!((max - min) / max < 0.01, "ripple {:.4}", (max - min) / max);
}
