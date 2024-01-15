use adsr::{managed_adsr::ManagedAdsr, Adsr};
use dsp::{
  filters::{
    biquad::{BiquadFilter, FilterMode},
    filter_chain::apply_filter_chain_and_compute_coefficients,
  },
  FRAME_SIZE,
};

use self::dynabandpass::DynabandpassFilter;

use super::{AdsrState, ParamSource, RenderRawParams, FILTER_PARAM_BUFFER_COUNT};

pub mod dynabandpass;

const ZERO_FRAME: [f32; FRAME_SIZE] = [0.; FRAME_SIZE];

#[derive(Clone, Copy)]
#[repr(usize)]
#[allow(dead_code)]
pub(crate) enum FilterType {
  Lowpass = 0,
  LP4 = 1,
  LP8 = 2,
  LP16 = 3,
  Highpass = 4,
  HP4 = 5,
  HP8 = 6,
  HP16 = 7,
  Bandpass = 8,
  BP4 = 9,
  BP8 = 10,
  BP16 = 11,
  DynaBp50 = 12,
  DynaBp100 = 13,
  DynaBp200 = 14,
  DynaBp400 = 15,
  DynaBp800 = 16,
  Lowshelf = 17,
  Highshelf = 18,
  Peaking = 19,
  Notch = 20,
  Allpass = 21,
}

impl FilterType {
  pub fn from_usize(val: usize) -> Self {
    if val > Self::Allpass as usize {
      panic!("Invalid FilterType value: {}", val);
    }
    unsafe { std::mem::transmute(val) }
  }
}

#[derive(Clone, Copy)]
pub(crate) enum FilterParamControlSource {
  Manual = 0,
  Envelope = 1,
  Buffer = 2,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum FilterParamType {
  Q,
  CutoffFreq,
  Gain,
}

impl FilterParamControlSource {
  pub fn from_usize(val: usize) -> Self {
    match val {
      0 => FilterParamControlSource::Manual,
      1 => FilterParamControlSource::Envelope,
      2 => FilterParamControlSource::Buffer,
      _ => panic!("Invalid filter param control source: {}", val),
    }
  }

  pub fn to_param_source(self, param_type: FilterParamType, manual_val: f32) -> ParamSource {
    match self {
      FilterParamControlSource::Manual => ParamSource::new_constant(manual_val),
      FilterParamControlSource::Envelope =>
        if matches!(param_type, FilterParamType::CutoffFreq) {
          let filter_adsr_shift = 20.;
          let filter_adsr_scale = 44_100. / 2. - filter_adsr_shift;
          ParamSource::PerVoiceADSR(AdsrState {
            adsr_ix: 0,
            scale: filter_adsr_scale,
            shift: filter_adsr_shift,
          })
        } else {
          panic!(
            "Only cutoff frequency supports ADSR param source, but it was provided for \
             {param_type:?}"
          );
        },
      FilterParamControlSource::Buffer => ParamSource::ParamBuffer(param_type as usize),
    }
  }
}

#[derive(Clone)]
pub(crate) enum FilterState {
  SimpleBiquad(FilterMode, BiquadFilter),
  Order4Biquad(FilterMode, [BiquadFilter; 2]),
  Order8Biquad(FilterMode, [BiquadFilter; 4]),
  Order16Biquad(FilterMode, [BiquadFilter; 8]),
  DynaBandpass(DynabandpassFilter),
}

const PRECOMPUTED_ORDER_4_BASE_Q_FACTORS: [f32; 2] = [-5.3329067, 2.322607];
const PRECOMPUTED_ORDER_8_BASE_Q_FACTORS: [f32; 4] = [-5.852078, -4.417527, -0.91537845, 8.174685];
const PRECOMPUTED_ORDER_16_BASE_Q_FACTORS: [f32; 8] = [
  -5.9786735, -5.638297, -4.929196, -3.7843077, -2.067771, 0.5116703, 4.7229195, 14.153371,
];

impl FilterState {
  pub fn new_simple_biquad(filter_mode: FilterMode) -> Self {
    Self::SimpleBiquad(filter_mode, BiquadFilter::default())
  }

  pub fn new_order4_biquad(filter_mode: FilterMode) -> Self {
    Self::Order4Biquad(filter_mode, [BiquadFilter::default(); 2])
  }

  pub fn new_order8_biquad(filter_mode: FilterMode) -> Self {
    Self::Order8Biquad(filter_mode, [BiquadFilter::default(); 4])
  }

  pub fn new_order16_biquad(filter_mode: FilterMode) -> Self {
    Self::Order16Biquad(filter_mode, [BiquadFilter::default(); 8])
  }

  pub fn get_filter_mode(&self) -> Option<FilterMode> {
    match self {
      FilterState::SimpleBiquad(filter_mode, _) => Some(*filter_mode),
      FilterState::Order4Biquad(filter_mode, _) => Some(*filter_mode),
      FilterState::Order8Biquad(filter_mode, _) => Some(*filter_mode),
      FilterState::Order16Biquad(filter_mode, _) => Some(*filter_mode),
      FilterState::DynaBandpass(_) => None,
    }
  }

  /// Called when a voice is gated.  Resets internal filter states to make it like the filter has
  /// been fed silence for an infinite amount of time.
  #[inline]
  pub fn reset(&mut self) {
    match self {
      FilterState::SimpleBiquad(_, biquad) => biquad.reset(),
      FilterState::Order4Biquad(_, chain) =>
        for filter in chain {
          filter.reset();
        },
      FilterState::Order8Biquad(_, chain) =>
        for filter in chain {
          filter.reset();
        },
      FilterState::Order16Biquad(_, chain) =>
        for filter in chain {
          filter.reset();
        },
      FilterState::DynaBandpass(filter) => filter.reset(),
    }
  }

  pub fn apply_frame(
    &mut self,
    q: &[f32; FRAME_SIZE],
    cutoff_freq: &[f32; FRAME_SIZE],
    gain: &[f32; FRAME_SIZE],
    frame: &mut [f32; FRAME_SIZE],
  ) {
    match self {
      FilterState::SimpleBiquad(filter_mode, biquad) =>
        for i in 0..frame.len() {
          let input = frame[i];
          let output = biquad.compute_coefficients_and_apply(
            *filter_mode,
            q[i],
            cutoff_freq[i],
            gain[i],
            input,
          );
          frame[i] = output;
        },
      FilterState::Order4Biquad(filter_mode, chain) => apply_filter_chain_and_compute_coefficients(
        chain,
        frame,
        *filter_mode,
        &PRECOMPUTED_ORDER_4_BASE_Q_FACTORS,
        q,
        cutoff_freq,
        gain,
      ),
      FilterState::Order8Biquad(filter_mode, chain) => apply_filter_chain_and_compute_coefficients(
        chain,
        frame,
        *filter_mode,
        &PRECOMPUTED_ORDER_8_BASE_Q_FACTORS,
        q,
        cutoff_freq,
        gain,
      ),
      FilterState::Order16Biquad(filter_mode, chain) =>
        apply_filter_chain_and_compute_coefficients(
          chain,
          frame,
          *filter_mode,
          &PRECOMPUTED_ORDER_16_BASE_Q_FACTORS,
          q,
          cutoff_freq,
          gain,
        ),
      FilterState::DynaBandpass(filter) => filter.apply_frame(frame, cutoff_freq),
    }
  }
}

#[derive(Clone)]
pub(crate) struct FilterModule {
  pub is_bypassed: bool,
  pub filter_type: FilterType,
  pub filter_state: FilterState,
  pub q: ParamSource,
  pub cutoff_freq: ParamSource,
  pub gain: ParamSource,
  pub rendered_q: [f32; FRAME_SIZE],
  pub rendered_cutoff_freq: [f32; FRAME_SIZE],
  pub rendered_gain: [f32; FRAME_SIZE],
}

impl Default for FilterModule {
  fn default() -> Self {
    Self {
      is_bypassed: false,
      filter_type: FilterType::Lowpass,
      filter_state: FilterState::new_simple_biquad(FilterMode::Lowpass),
      q: ParamSource::new_constant(1.),
      cutoff_freq: ParamSource::new_constant(440.),
      gain: ParamSource::new_constant(0.),
      rendered_q: [0.; FRAME_SIZE],
      rendered_cutoff_freq: [0.; FRAME_SIZE],
      rendered_gain: [0.; FRAME_SIZE],
    }
  }
}

impl FilterModule {
  pub fn set_filter_type(&mut self, new_filter_type: FilterType) {
    self.filter_type = new_filter_type;
    self.filter_state = match new_filter_type {
      FilterType::Lowpass => FilterState::new_simple_biquad(FilterMode::Lowpass),
      FilterType::LP4 => FilterState::new_order4_biquad(FilterMode::Lowpass),
      FilterType::LP8 => FilterState::new_order8_biquad(FilterMode::Lowpass),
      FilterType::LP16 => FilterState::new_order16_biquad(FilterMode::Lowpass),
      FilterType::Highpass => FilterState::new_simple_biquad(FilterMode::Highpass),
      FilterType::HP4 => FilterState::new_order4_biquad(FilterMode::Highpass),
      FilterType::HP8 => FilterState::new_order8_biquad(FilterMode::Highpass),
      FilterType::HP16 => FilterState::new_order16_biquad(FilterMode::Highpass),
      FilterType::Bandpass => FilterState::new_simple_biquad(FilterMode::Bandpass),
      FilterType::BP4 => FilterState::new_order4_biquad(FilterMode::Bandpass),
      FilterType::BP8 => FilterState::new_order8_biquad(FilterMode::Bandpass),
      FilterType::BP16 => FilterState::new_order16_biquad(FilterMode::Bandpass),
      FilterType::DynaBp50 => FilterState::DynaBandpass(DynabandpassFilter::new(50.)),
      FilterType::DynaBp100 => FilterState::DynaBandpass(DynabandpassFilter::new(100.)),
      FilterType::DynaBp200 => FilterState::DynaBandpass(DynabandpassFilter::new(200.)),
      FilterType::DynaBp400 => FilterState::DynaBandpass(DynabandpassFilter::new(400.)),
      FilterType::DynaBp800 => FilterState::DynaBandpass(DynabandpassFilter::new(800.)),
      FilterType::Lowshelf => FilterState::new_simple_biquad(FilterMode::Lowshelf),
      FilterType::Highshelf => FilterState::new_simple_biquad(FilterMode::Highshelf),
      FilterType::Peaking => FilterState::new_simple_biquad(FilterMode::Peak),
      FilterType::Notch => FilterState::new_simple_biquad(FilterMode::Notch),
      FilterType::Allpass => FilterState::new_simple_biquad(FilterMode::Allpass),
    };
  }

  pub fn set_q(&mut self, new_q: ParamSource) { self.q.replace(new_q); }

  pub fn set_cutoff_freq(&mut self, new_cutoff_freq: ParamSource) {
    self.cutoff_freq.replace(new_cutoff_freq);
  }

  pub fn set_gain(&mut self, new_gain: ParamSource) { self.gain.replace(new_gain); }

  /// Called when a voice is gated.  Resets internal filter states to make it like the filter has
  /// been fed silence for an infinite amount of time.
  #[inline]
  pub fn reset(&mut self) { self.filter_state.reset(); }

  pub fn apply_frame(
    &mut self,
    filter_envelope_generator: &mut ManagedAdsr,
    frame: &mut [f32; FRAME_SIZE],
    filter_param_buffers: &[[f32; FRAME_SIZE]; FILTER_PARAM_BUFFER_COUNT],
    cur_bpm: f32,
    cur_frame_start_beat: f32,
  ) {
    if self.is_bypassed {
      return;
    }

    match &self.cutoff_freq {
      ParamSource::Constant { .. } => (),
      ParamSource::ParamBuffer(_) => (),
      ParamSource::PerVoiceADSR(_) => {
        filter_envelope_generator.render_frame(1., 0., cur_bpm, cur_frame_start_beat);
      },
      _ => panic!("Unsupported ParamSource for cutoff_freq"),
    }

    let render_params = RenderRawParams {
      param_buffers: filter_param_buffers,
      adsrs: unsafe {
        std::slice::from_raw_parts((&(filter_envelope_generator.adsr)) as *const Adsr, 1)
      },
      base_frequencies: &ZERO_FRAME,
    };

    self
      .cutoff_freq
      .render_raw(&render_params, &mut self.rendered_cutoff_freq);
    let filter_mode = self.filter_state.get_filter_mode();
    let gain = if filter_mode.map(|mode| mode.needs_gain()).unwrap_or(false) {
      self
        .gain
        .render_raw(&render_params, &mut self.rendered_gain);
      &self.rendered_gain
    } else {
      &ZERO_FRAME
    };
    let q = if filter_mode.map(|mode| mode.needs_q()).unwrap_or(false) {
      self.q.render_raw(&render_params, &mut self.rendered_q);
      &self.rendered_q
    } else {
      &ZERO_FRAME
    };

    self
      .filter_state
      .apply_frame(q, &self.rendered_cutoff_freq, gain, frame);
  }
}
