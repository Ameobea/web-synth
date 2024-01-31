//! Granular synth operating on a fixed buffer of samples.  It has multiple voices that each exist
//! at different places within a selection of the sample buffer and move at different speeds,
//! seeding grains from where they currently are playing.
//!
//! Several aspects of this design draw significant inspiration from the Clouds eurorack module made
//! by Mutable Instruments and associated code which is available on Github: https://github.com/pichenettes/eurorack

use common::ref_static_mut;
use dsp::{clamp, filters::butterworth::ButterworthFilter, mix, read_interpolated, smooth};
use rand::prelude::*;

pub mod sample_recorder;

const FRAME_SIZE: usize = 128;

#[derive(Clone, Copy)]
pub struct ReverseState {
  pub grain_is_reversed: bool,
  pub grain_movement_is_reversed: bool,
}

impl Default for ReverseState {
  fn default() -> Self {
    ReverseState {
      grain_is_reversed: false,
      grain_movement_is_reversed: false,
    }
  }
}

static mut SCRATCH: [(f32, f32); 8192] = [(0.0, 0.0); 8192];
fn scratch() -> &'static mut [(f32, f32); 8192] { ref_static_mut!(SCRATCH) }

#[derive(Clone)]
pub struct GranularVoice {
  /// The index at which the current grain starts in the waveform buffer, absolute to the buffer
  pub cur_grain_start: f32,
  pub reversed: ReverseState,
  filter: ButterworthFilter,
  filter_cutoff: f32,
  pub grains: Vec<Grain>,
  pub samples_since_last_grain: f32,
}

impl Default for GranularVoice {
  fn default() -> Self {
    GranularVoice {
      cur_grain_start: 0.0,
      reversed: ReverseState::default(),
      filter: ButterworthFilter::default(),
      filter_cutoff: 0.,
      grains: Vec::with_capacity(128),
      samples_since_last_grain: 0.,
    }
  }
}

#[derive(Clone)]
pub struct Grain {
  pub len_samples: f32,
  /// Absolute index of the sample in the main buffer where this grain starts
  pub start_sample_ix: f32,
  pub samples_read_so_far: f32,
  pub sample_playback_ratio: f32,
  pub linear_slope_length: f32,
  pub slope_linearity: f32,
}

impl Grain {
  fn compute_linear_envelope_volume(&self, pos_in_grain: f32, linear_slope_length: f32) -> f32 {
    let pos_in_grain = if pos_in_grain < 0.5 {
      pos_in_grain
    } else {
      // Reflect across the 0.5 axis, mirroring the function from 0 to 0.5
      0.5 - (pos_in_grain - 0.5)
    };
    ((pos_in_grain * 2.) / linear_slope_length).min(1.)
  }

  /// `linear_slope_length` determines how far into the grain the envelope extends on either side.
  /// A value of 0 means that no envelope will be applied and a slope of 1 means that the
  /// envelope will extend all the way to the center of the waveform creating a triangle.
  ///
  /// `slope_linearity` determines the envelope mix between the linear slope determined by
  /// `linear_slope_length` and the sine.  It's a simple 0 to 1 mix between the linear slope and
  /// the sine.
  fn get_volume(&self, pos_in_grain: f32, linear_slope_length: f32, slope_linearity: f32) -> f32 {
    let linear_slope = self.compute_linear_envelope_volume(pos_in_grain, linear_slope_length);
    let sine_slope = (pos_in_grain * std::f32::consts::PI).sin();
    mix(slope_linearity, linear_slope, sine_slope)
  }

  /// Returns `true` is this grain has more samples to play and `false` if it's been fully
  /// consumed
  pub fn tick(&mut self) -> bool {
    self.samples_read_so_far += self.sample_playback_ratio;
    self.samples_read_so_far < self.len_samples
  }

  pub fn sample(
    &self,
    buf: &[f32],
    is_reversed: bool,
    linear_slope_length: f32,
    slope_linearity: f32,
  ) -> (f32, f32) {
    let pos_in_grain = self.samples_read_so_far / self.len_samples;
    let sample_ix = if is_reversed {
      self.len_samples - self.samples_read_so_far
    } else {
      self.samples_read_so_far
    };

    let gain = self.get_volume(pos_in_grain, linear_slope_length, slope_linearity);
    let sample = read_interpolated(buf, self.start_sample_ix + sample_ix);
    (gain, sample)
  }
}

pub struct GranularCtx {
  pub waveform: Vec<f32>,
  /// The offset from `cur_grain_start` at which the latest sample will be read
  pub cur_sample_offset: f32,
  pub rendered_output: [f32; FRAME_SIZE],
  pub voices: [GranularVoice; 2],
  pub last_start_sample_ix: f32,
  pub last_end_sample_ix: f32,
  pub last_grain_size: f32,
}

impl Default for GranularCtx {
  fn default() -> Self {
    GranularCtx {
      waveform: Vec::new(),
      cur_sample_offset: 0.0,
      rendered_output: [0.0; FRAME_SIZE],
      voices: [GranularVoice::default(), GranularVoice::default()],
      last_start_sample_ix: -10.0,
      last_end_sample_ix: -10.0,
      last_grain_size: 800.,
    }
  }
}

fn normalize_gain(samples_and_gains: &[(f32, f32)], total_gain: f32) -> f32 {
  let gain_multiplier = if total_gain < 1. {
    1.
  } else {
    1. / (total_gain + 0.001) // Maybe this should be scaled differently
  };

  samples_and_gains.iter().fold(0.0, |acc, (sample, gain)| {
    acc + sample * gain * gain_multiplier
  })
}

impl GranularVoice {
  fn move_read_head(
    &mut self,
    selection_start_sample_ix: f32,
    selection_end_sample_ix: f32,
    grain_size: f32,
    movement_samples_per_sample: f32,
  ) {
    self.cur_grain_start = clamp(
      selection_start_sample_ix,
      selection_end_sample_ix,
      self.cur_grain_start,
    );
    // TODO: Handle reverse
    self.cur_grain_start += movement_samples_per_sample;

    if self.cur_grain_start + grain_size > selection_end_sample_ix {
      // Grain would overflow the selection; we need to wrap it back around to the start of
      // the selection
      let selection_len = selection_end_sample_ix - selection_start_sample_ix;
      let offset_from_selection_start = self.cur_grain_start - selection_start_sample_ix;
      let new_offset_from_selection_start =
        offset_from_selection_start % (selection_len - grain_size);
      self.cur_grain_start = new_offset_from_selection_start + selection_start_sample_ix;
    }
  }

  fn seed_grain(
    &mut self,
    grain_size: f32,
    linear_slope_length: f32,
    slope_linearity: f32,
    sample_playback_ratio: f32,
    grain_start_randomness_samples: f32,
    sample_buffer_len: usize,
  ) {
    let start_offset = if grain_start_randomness_samples == 0. {
      0.
    } else {
      common::rng().gen_range(
        -(grain_start_randomness_samples.abs()) / 2.,
        (grain_start_randomness_samples.abs()) / 2.,
      )
    };

    self.grains.push(Grain {
      len_samples: grain_size,
      start_sample_ix: clamp(
        0.,
        (sample_buffer_len - 1) as f32,
        self.cur_grain_start + start_offset,
      ),
      samples_read_so_far: 0.,
      sample_playback_ratio: clamp(0.001, 1000., sample_playback_ratio),
      linear_slope_length,
      slope_linearity,
    });
  }

  fn maybe_seed_new_grain(
    &mut self,
    samples_between_grains: f32,
    grain_size: f32,
    linear_slope_length: f32,
    slope_linearity: f32,
    sample_playback_ratio: f32,
    grain_start_randomness_samples: f32,
    sample_buffer_len: usize,
  ) {
    if sample_playback_ratio <= 0.05 {
      return;
    }

    self.samples_since_last_grain += 1.;
    if self.grains.len() >= scratch().len() {
      // Can't exceed the ridiculous max grain count
      return;
    }

    if self.samples_since_last_grain >= samples_between_grains {
      self.samples_since_last_grain -= samples_between_grains;
      self.seed_grain(
        grain_size,
        linear_slope_length,
        slope_linearity,
        sample_playback_ratio,
        grain_start_randomness_samples,
        sample_buffer_len,
      );
    }
  }

  fn tick_grains(&mut self) {
    // Tick grains and remove grains that are done playing
    let mut i = 0;
    while i < self.grains.len() {
      let is_still_running = {
        let grain = &mut self.grains[i];
        grain.tick()
      };
      if !is_still_running {
        self.grains.swap_remove(i);
      } else {
        i += 1;
      }
    }
  }

  pub fn update_and_get_sample(
    &mut self,
    waveform: &[f32],
    selection_start_sample_ix: f32,
    selection_end_sample_ix: f32,
    grain_size: f32,
    // Positive values are highpass, negative values are lowpass
    filter_cutoff: f32,
    linear_slope_length: f32,
    slope_linearity: f32,
    samples_between_grains: f32,
    movement_samples_per_sample: f32,
    sample_speed_ratio: f32,
    grain_start_randomness_samples: f32,
  ) -> f32 {
    self.move_read_head(
      selection_start_sample_ix,
      selection_end_sample_ix,
      grain_size,
      movement_samples_per_sample,
    );

    self.maybe_seed_new_grain(
      samples_between_grains,
      grain_size,
      linear_slope_length,
      slope_linearity,
      sample_speed_ratio,
      grain_start_randomness_samples,
      waveform.len(),
    );

    self.tick_grains();

    let samples_and_gains = scratch();
    let mut total_gain = 0.;
    let mut active_grain_count = 0;
    self.grains.iter().for_each(|grain| {
      let (gain, sample) = grain.sample(
        waveform,
        self.reversed.grain_is_reversed,
        linear_slope_length,
        slope_linearity,
      );
      total_gain += gain;
      samples_and_gains[active_grain_count] = (gain, sample);
      active_grain_count += 1;
    });

    let sample = normalize_gain(&samples_and_gains[0..active_grain_count], total_gain);

    smooth(&mut self.filter_cutoff, filter_cutoff, 0.9);
    if self.filter_cutoff.abs() < 15. {
      return sample;
    }

    // Apply filter
    if filter_cutoff > 0. {
      self.filter.lowpass(self.filter_cutoff, sample)
    } else {
      self.filter.highpass(-self.filter_cutoff, sample)
    }
  }
}

impl GranularCtx {
  pub fn get_sample(
    &mut self,
    selection_start_sample_ix: f32,
    selection_end_sample_ix: f32,
    grain_size: f32,
    linear_slope_length: f32,
    slope_linearity: f32,
    voice_1_filter_cutoff: f32,
    voice_2_filter_cutoff: f32,
    voice_1_samples_between_grains: f32,
    voice_2_samples_between_grains: f32,
    voice_1_gain: f32,
    voice_2_gain: f32,
    voice_1_movement_samples_per_sample: f32,
    voice_2_movement_samples_per_sample: f32,
    voice_1_sample_speed_ratio: f32,
    voice_2_sample_speed_ratio: f32,
    voice_1_grain_start_randomness_samples: f32,
    voice_2_grain_start_randomness_samples: f32,
  ) -> f32 {
    let v1_sample = self.voices[0].update_and_get_sample(
      &self.waveform,
      selection_start_sample_ix,
      selection_end_sample_ix,
      grain_size,
      voice_1_filter_cutoff,
      linear_slope_length,
      slope_linearity,
      voice_1_samples_between_grains,
      voice_1_movement_samples_per_sample,
      voice_1_sample_speed_ratio,
      voice_1_grain_start_randomness_samples,
    );
    let v2_sample = self.voices[1].update_and_get_sample(
      &self.waveform,
      selection_start_sample_ix,
      selection_end_sample_ix,
      grain_size,
      voice_2_filter_cutoff,
      linear_slope_length,
      slope_linearity,
      voice_2_samples_between_grains,
      voice_2_movement_samples_per_sample,
      voice_2_sample_speed_ratio,
      voice_2_grain_start_randomness_samples,
    );
    (v1_sample * 0.5 * voice_1_gain) + (v2_sample * 0.5 * voice_2_gain)
  }
}

#[no_mangle]
pub fn create_granular_instance() -> *mut GranularCtx {
  common::maybe_init(None);
  let ctx = Box::new(GranularCtx::default());
  Box::into_raw(ctx)
}

#[no_mangle]
pub fn get_granular_waveform_ptr(ctx: *mut GranularCtx, new_waveform_len: usize) -> *mut f32 {
  unsafe {
    (*ctx).waveform = Vec::with_capacity(new_waveform_len);
    (*ctx).waveform.set_len(new_waveform_len);
    (*ctx).waveform.as_mut_ptr()
  }
}

// #[no_mangle]
// pub fn set_is_reversed(ctx: *mut GranularCtx, voice_ix: usize, is_reversed: bool) {
//     unsafe {
//         (*ctx).voices[voice_ix].reversed.is_reversed = is_reversed;
//     }
// }

#[no_mangle]
pub fn render_granular(
  ctx: *mut GranularCtx,
  selection_start_sample_ix: f32,
  selection_end_sample_ix: f32,
  grain_size: f32,
  voice_1_filter_cutoff: f32,
  voice_2_filter_cutoff: f32,
  linear_slope_length: f32,
  slope_linearity: f32,
  voice_1_movement_samples_per_sample: f32,
  voice_2_movement_samples_per_sample: f32,
  voice_1_sample_speed_ratio: f32,
  voice_2_sample_speed_ratio: f32,
  voice_1_samples_between_grains: f32,
  voice_2_samples_between_grains: f32,
) -> *const f32 {
  let ctx = unsafe { &mut *ctx };

  // Apply smoothing to the input of the start and end sample to try to avoid clicking
  if ctx.last_start_sample_ix > 0. {
    smooth(
      &mut ctx.last_start_sample_ix,
      selection_start_sample_ix,
      0.995,
    );
  } else {
    ctx.last_start_sample_ix = selection_start_sample_ix;
  }
  if ctx.last_end_sample_ix > 0. {
    smooth(&mut ctx.last_end_sample_ix, selection_end_sample_ix, 0.995);
  } else {
    ctx.last_end_sample_ix = selection_end_sample_ix;
  }
  // Smoothing for grain size
  smooth(&mut ctx.last_grain_size, grain_size, 0.9);

  // Start and end samples must be within the waveform
  if ctx.last_end_sample_ix >= ctx.waveform.len() as f32 {
    ctx.last_end_sample_ix = ctx.waveform.len() as f32 - 1.;
  }
  if ctx.last_start_sample_ix >= ctx.waveform.len() as f32 {
    ctx.last_start_sample_ix = ctx.waveform.len() as f32 - 1.;
  }

  // End sample can't be less than start sample
  if ctx.last_end_sample_ix < ctx.last_start_sample_ix {
    ctx.last_end_sample_ix = ctx.last_start_sample_ix;
  }

  let linear_slope_length = clamp(0.001, 1.0, linear_slope_length);
  let slope_linearity = clamp(0.001, 1.0, slope_linearity);

  for i in 0..FRAME_SIZE {
    let sample = ctx.get_sample(
      selection_start_sample_ix,
      selection_end_sample_ix,
      ctx.last_grain_size,
      linear_slope_length,
      slope_linearity,
      voice_1_filter_cutoff,
      voice_2_filter_cutoff,
      voice_1_samples_between_grains,
      voice_2_samples_between_grains,
      1.,
      0.,
      voice_1_movement_samples_per_sample,
      voice_2_movement_samples_per_sample,
      voice_1_sample_speed_ratio,
      voice_2_sample_speed_ratio,
      200.,
      0.,
    );
    ctx.rendered_output[i] = sample;
  }

  ctx.rendered_output.as_ptr()
}
