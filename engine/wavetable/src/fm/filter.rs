use adsr::{managed_adsr::ManagedAdsr, Adsr};
use dsp::{
  filters::{
    biquad::{BiquadFilter, FilterMode},
    filter_chain::apply_filter_chain_and_compute_coefficients,
  },
  FRAME_SIZE,
};

use super::{ParamSource, RenderRawParams, FILTER_PARAM_BUFFER_COUNT};

#[derive(Clone, Copy)]
#[repr(usize)]
enum FilterType {
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

#[derive(Clone)]
enum FilterState {
  SimpleBiquad(FilterMode, BiquadFilter),
  Order4Biquad(FilterMode, [BiquadFilter; 2]),
  Order8Biquad(FilterMode, [BiquadFilter; 4]),
  Order16Biquad(FilterMode, [BiquadFilter; 8]),
}

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

  pub fn get_filter_mode(&self) -> FilterMode {
    match self {
      FilterState::SimpleBiquad(filter_mode, _) => *filter_mode,
      FilterState::Order4Biquad(filter_mode, _) => *filter_mode,
      FilterState::Order8Biquad(filter_mode, _) => *filter_mode,
      FilterState::Order16Biquad(filter_mode, _) => *filter_mode,
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
            0.,
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
        q,
        cutoff_freq,
        gain,
      ),
      FilterState::Order8Biquad(filter_mode, chain) => apply_filter_chain_and_compute_coefficients(
        chain,
        frame,
        *filter_mode,
        q,
        cutoff_freq,
        gain,
      ),
      FilterState::Order16Biquad(filter_mode, chain) =>
        apply_filter_chain_and_compute_coefficients(
          chain,
          frame,
          *filter_mode,
          q,
          cutoff_freq,
          gain,
        ),
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

const ZERO_FRAME: [f32; FRAME_SIZE] = [0.; FRAME_SIZE];

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
      FilterType::DynaBp50 => FilterState::new_simple_biquad(FilterMode::Bandpass),
      FilterType::DynaBp100 => FilterState::new_simple_biquad(FilterMode::Bandpass),
      FilterType::DynaBp200 => FilterState::new_simple_biquad(FilterMode::Bandpass),
      FilterType::DynaBp400 => FilterState::new_simple_biquad(FilterMode::Bandpass),
      FilterType::DynaBp800 => FilterState::new_simple_biquad(FilterMode::Bandpass),
      FilterType::Lowshelf => FilterState::new_simple_biquad(FilterMode::Lowshelf),
      FilterType::Highshelf => FilterState::new_simple_biquad(FilterMode::Highshelf),
      FilterType::Peaking => FilterState::new_simple_biquad(FilterMode::Peak),
      FilterType::Notch => FilterState::new_simple_biquad(FilterMode::Notch),
      FilterType::Allpass => unimplemented!(),
    };
  }

  // TODO: Setters for param sources

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
        // Currently hard-coded output range from [20, 44_100 / 2]
        let filter_adsr_shift = 20.;
        let filter_adsr_scale = 44_100. / 2. - filter_adsr_shift;
        filter_envelope_generator.render_frame(
          filter_adsr_scale,
          filter_adsr_shift,
          cur_bpm,
          cur_frame_start_beat,
        );
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
    let gain = if filter_mode.needs_gain() {
      self
        .gain
        .render_raw(&render_params, &mut self.rendered_gain);
      &self.rendered_gain
    } else {
      &ZERO_FRAME
    };
    let q = if filter_mode.needs_q() {
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
