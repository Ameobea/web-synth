#![feature(get_mut_unchecked, array_windows)]

use std::rc::Rc;

use dsp::mk_linear_to_log;

#[cfg(feature = "exports")]
pub mod exports;
pub mod managed_adsr;
#[cfg(test)]
mod tests;

extern "C" {
  pub fn debug1(v1: f32, v2: f32, v3: f32);
}

/// Samples per second
const SAMPLE_RATE: usize = 44_100;
pub const RENDERED_BUFFER_SIZE: usize = SAMPLE_RATE;
const FRAME_SIZE: usize = 128;

#[derive(Clone, Copy)]
pub enum RampFn {
  Instant,
  Linear,
  Exponential { exponent: f32 },
}

impl RampFn {
  pub fn from_u32(type_val: u32, param: f32) -> Self {
    match type_val {
      0 => Self::Instant,
      1 => Self::Linear,
      2 => Self::Exponential { exponent: param },
      _ => panic!("Invlaid ramper fn type: {}", type_val),
    }
  }
}

fn compute_pos(prev_step: &AdsrStep, next_step: &AdsrStep, phase: f32) -> f32 {
  let distance = next_step.x - prev_step.x;
  debug_assert!(distance > 0.);

  match next_step.ramper {
    RampFn::Instant => prev_step.y,
    RampFn::Linear => {
      let y_diff = next_step.y - prev_step.y;
      let distance = next_step.x - prev_step.x;
      let pct_complete = (phase - prev_step.x) / distance;
      prev_step.y + pct_complete * y_diff
    },
    RampFn::Exponential { exponent } => {
      let y_diff = next_step.y - prev_step.y;
      let x = (phase - prev_step.x) / distance;
      prev_step.y + x.powf(exponent) * y_diff
      // prev_step.y + even_faster_pow(x, exponent) * y_diff
    },
  }
}

#[derive(Clone, Copy)]
pub struct AdsrStep {
  pub x: f32,
  pub y: f32,
  pub ramper: RampFn,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum GateStatus {
  Gated,
  /// We have progressed through the envelope and reached the release point.  No loop point was
  /// provided, and the output value at that instant has been locked in.  The output buffer has
  /// been pre-filled with that value, so rendering is not required until afer the ADSR is
  /// un-gated and the release is triggered.
  GatedFrozen,
  /// We released the note before the we reached the release point.  To avoid the issue where
  /// audio artifacts emerge because we jump from the current phase to the release point, we add
  /// the option to smoothly mix between the current value and the release value.
  EarlyRelease {
    /// The x value of the ADSR when it was released.  MUST be < `release_start_phase` or else
    /// we wouldn't do early release and would continue following the envelope like normal.
    start_x: f32,
    /// The y value of the ADSR when it was released
    start_y: f32,
    /// The y value of the envelope at `release_start_phase`
    release_start_point_y: f32,
    /// Number of samples in the early release that we've processed so far
    cur_progress_samples: usize,
  },
  Releasing,
  /// The ADSR has been released and reached the end of its phase.  The output buffer has been
  /// filled with the final output value, and further rendering is not required.
  Done,
}

/// Method that we use if releasing the ADSR before we reach the release point
#[derive(Clone, PartialEq, Debug)]
pub enum EarlyReleaseStrategy {
  /// We mix linearly between the start value (value of the ADSR when it was released) and the
  /// value at the release point linearly
  LinearMix,
  /// We follow the ADSR's envelope at an increased speed, bridging the gap between the point at
  /// which the ADSR was released and the release point in `len_samples` samples
  FastEnvelopeFollow,
  /// We output the value at the point at which the ADSR was released forever
  Freeze,
  /// We scan through the envelope after the release point to find the first point at which it has
  /// a value which is the same as the current value, do a fast linear mix to that point, and then
  /// follow the envelope at normal speed from there.
  ///
  /// If no such point is found, behaves like `LinearMix`.
  ScanToMatchThenFollow,
}

/// Determines how we handle releasing if the ADSR is ungated before the release point
#[derive(Clone)]
pub struct EarlyReleaseConfig {
  pub strategy: EarlyReleaseStrategy,
  pub len_samples: usize,
}

impl EarlyReleaseConfig {
  pub(crate) fn from_parts(
    early_release_mode_type: usize,
    early_release_mode_param: usize,
  ) -> EarlyReleaseConfig {
    match early_release_mode_type {
      0 => EarlyReleaseConfig {
        strategy: EarlyReleaseStrategy::LinearMix,
        len_samples: early_release_mode_param,
      },
      1 => EarlyReleaseConfig {
        strategy: EarlyReleaseStrategy::FastEnvelopeFollow,
        len_samples: early_release_mode_param,
      },
      2 => EarlyReleaseConfig {
        strategy: EarlyReleaseStrategy::Freeze,
        len_samples: 0,
      },
      3 => EarlyReleaseConfig {
        strategy: EarlyReleaseStrategy::ScanToMatchThenFollow,
        len_samples: early_release_mode_param,
      },
      _ => panic!(
        "Invalid early release mode type: {}",
        early_release_mode_type
      ),
    }
  }
}

impl Default for EarlyReleaseConfig {
  fn default() -> Self {
    EarlyReleaseConfig {
      strategy: EarlyReleaseStrategy::LinearMix,
      len_samples: SAMPLE_RATE / 4,
    }
  }
}

#[derive(Clone)]
pub struct Adsr {
  /// From 0 to 1 representing position in the ADSR from start to end
  pub phase: f32,
  pub gate_status: GateStatus,
  pub release_start_phase: f32,
  pub early_release_config: EarlyReleaseConfig,
  steps: Vec<AdsrStep>,
  /// If provided, once the ADSR hits point `release_start_phase`, it will loop back to
  /// `loop_point` until it is released.
  loop_point: Option<f32>,
  /// Contains the rendered waveform the for ADSR from start to end, used as an optimization to
  /// avoid having to compute ramp points every sample
  rendered: Rc<[f32; RENDERED_BUFFER_SIZE]>,
  /// A buffer into which the current output for the ADSR is rendered each frame
  cur_frame_output: Box<[f32; FRAME_SIZE]>,
  len_samples: f32,
  /// Beat on which the current gate started.  If loop is enabled, this is the beat on which the
  /// current loop started.
  gated_beat: f32,
  /// If this is set, it is assumed that the ADSR is in beats length mode.  In this case, the
  /// ADSR will be synchronized with the global beat counter.
  len_beats: Option<f32>,
  /// Optimization to avoid having to do some math in the hot path.  Always should be equal to
  /// `(1 / len_samples) `
  cached_phase_diff_per_sample: f32,
  /// If set, whenever the ADSR is updated, the most recent phase will be written to this
  /// pointer.  This is used to facilitate rendering of ADSRs in the UI by sharing some memory
  /// containing the current phase of all active ADSRs.
  pub store_phase_to: Option<*mut f32>,
  pub log_scale: bool,
}

const DEFAULT_FIRST_STEP: AdsrStep = AdsrStep {
  x: 0.,
  y: 0.,
  ramper: RampFn::Instant,
};

impl Adsr {
  pub fn new(
    steps: Vec<AdsrStep>,
    loop_point: Option<f32>,
    len_samples: f32,
    len_beats: Option<f32>,
    release_start_phase: f32,
    rendered: Rc<[f32; RENDERED_BUFFER_SIZE]>,
    early_release_config: EarlyReleaseConfig,
    log_scale: bool,
  ) -> Self {
    Adsr {
      phase: 0.,
      gate_status: GateStatus::Done,
      release_start_phase: match loop_point {
        Some(loop_point) => release_start_phase.max(loop_point),
        _ => release_start_phase,
      },
      early_release_config,
      steps,
      loop_point,
      rendered,
      cur_frame_output: Box::new([0.; FRAME_SIZE]),
      len_samples,
      gated_beat: 0.,
      len_beats,
      cached_phase_diff_per_sample: (1. / len_samples),
      store_phase_to: None,
      log_scale,
    }
  }

  pub fn gate(&mut self, cur_beat: f32) {
    self.phase = 0.;
    self.gated_beat = cur_beat;
    self.gate_status = GateStatus::Gated;
  }

  pub fn ungate(&mut self) {
    if self.phase < self.release_start_phase {
      let cur_y = dsp::read_interpolated(
        &*self.rendered,
        self.phase * (RENDERED_BUFFER_SIZE - 2) as f32,
      );

      'scan: {
        if self.early_release_config.strategy != EarlyReleaseStrategy::ScanToMatchThenFollow {
          break 'scan;
        }

        let release_start_ix = ((self.release_start_phase * (RENDERED_BUFFER_SIZE - 2) as f32)
          as usize)
          .saturating_sub(2);

        // scan through the release portion of the rendered buffer to find the first point where
        // the value is almost the same as the current value
        let Some(post_release_start_ix) = self.rendered[release_start_ix..]
          .array_windows::<2>()
          .position(|&[a, b]| (a <= cur_y && cur_y <= b) || (b <= cur_y && cur_y <= a))
        else {
          // No match found in the release; behave like `LinearMix`
          break 'scan;
        };

        let [a, b] = [
          self.rendered[release_start_ix + post_release_start_ix],
          self.rendered[release_start_ix + post_release_start_ix + 1],
        ];
        let ix = post_release_start_ix as f32
          + if a == cur_y || a == b {
            0.
          } else if b == cur_y {
            1.
          } else {
            (cur_y - a) / (b - a)
          };
        self.phase = dsp::clamp(
          0.,
          1.,
          (ix + release_start_ix as f32) / ((RENDERED_BUFFER_SIZE - 2) as f32),
        );

        self.gate_status = GateStatus::Releasing;
        return;
      }

      self.gate_status = GateStatus::EarlyRelease {
        start_x: self.phase,
        start_y: cur_y,
        release_start_point_y: dsp::read_interpolated(
          &*self.rendered,
          self.release_start_phase * (RENDERED_BUFFER_SIZE - 2) as f32,
        ),
        cur_progress_samples: 0,
      };
    } else {
      self.phase = self.release_start_phase;
      self.gate_status = match self.gate_status {
        GateStatus::Done => GateStatus::Done,
        _ => GateStatus::Releasing,
      };
    }
  }

  /// Renders the ADSR into the shared buffer.  Only needs to be called once for all ADSRs that
  /// share this associated buffer.
  pub fn render(&mut self) {
    let mut prev_step_opt: Option<&AdsrStep> = None;
    let mut next_step_opt: Option<&AdsrStep> = self.steps.get(0);
    let mut next_step_ix = 0usize;
    let buf = unsafe { Rc::get_mut_unchecked(&mut self.rendered) };

    for i in 0..RENDERED_BUFFER_SIZE {
      let phase = i as f32 / RENDERED_BUFFER_SIZE as f32;

      // Check to see if we've reached past the `next_step` and move through the steps if so
      while let Some(next_step) = next_step_opt.as_mut() {
        // Still not past it
        if next_step.x >= phase {
          break;
        }

        next_step_ix += 1;
        prev_step_opt = Some(*next_step);
        next_step_opt = self.steps.get(next_step_ix);
      }

      // Handle garbage steps that have the same x as the previous step
      while prev_step_opt
        .map(|step| step.x)
        .unwrap_or(DEFAULT_FIRST_STEP.x)
        == next_step_opt.map(|step| step.x).unwrap_or(100.)
      {
        next_step_ix += 1;
        prev_step_opt = Some(next_step_opt.unwrap());
        next_step_opt = self.steps.get(next_step_ix);
      }

      let next_step = match next_step_opt.as_mut() {
        Some(step) => step,
        None => {
          // If there are no more steps and an end step isn't provided, we just hold the
          // value from the last step we have
          buf[i] = prev_step_opt.map(|step| step.y).unwrap_or(0.);
          continue;
        },
      };

      let prev_step = prev_step_opt.unwrap_or(&DEFAULT_FIRST_STEP);
      buf[i] = compute_pos(prev_step, next_step, phase);
    }

    // Make sure that when we fully finish the ADSR, we emit the final step's terminal value
    // forever instead of getting stuck a few indices before the end due to mixing/etc.
    match self.steps.last() {
      Some(step) if step.x == 1. => {
        buf[buf.len() - 2] = step.y;
        buf[buf.len() - 1] = step.y;
      },
      _ => (),
    }
  }

  pub fn set_len(&mut self, new_len_samples: f32, new_len_beats: Option<f32>) {
    self.len_samples = new_len_samples;
    self.len_beats = new_len_beats;
    self.cached_phase_diff_per_sample = 1. / new_len_samples;
  }

  /// Advance phase by one sample's worth
  ///
  /// TODO: Fastpath this if we are not close to hitting the decay point (if gated) or the end of
  /// the waveform (if released)
  fn advance_phase(
    &mut self,
    cur_frame_start_phase: &mut f32,
    cur_frame_start_beat: f32,
    cur_oversampled_ix_in_frame: usize,
    oversample_factor: usize,
  ) {
    if let GateStatus::EarlyRelease {
      cur_progress_samples,
      ..
    } = &mut self.gate_status
    {
      *cur_progress_samples += 1;
      if *cur_progress_samples <= self.early_release_config.len_samples {
        return;
      } else {
        match self.early_release_config.strategy {
          EarlyReleaseStrategy::LinearMix
          | EarlyReleaseStrategy::FastEnvelopeFollow
          | EarlyReleaseStrategy::ScanToMatchThenFollow => {
            self.phase = self.release_start_phase;
            self.gate_status = GateStatus::Releasing;
          },
          EarlyReleaseStrategy::Freeze => (),
        }
      }
    }

    let phase_diff = self.cached_phase_diff_per_sample / oversample_factor as f32;

    if *cur_frame_start_phase > -1. && self.len_beats.is_some() && cur_frame_start_beat > 0. {
      let len_beats = self.len_beats.unwrap();

      // In order to keep our phase in sync with the global beat counter and prevent drift
      // caused by floating point inaccuracies and other things, we interpolate between the
      // phase we count ourselves and the expected phase at the end of the current frame as
      // computed from the current beat from the global beat counter.

      let cur_loop_progress_beats = (cur_frame_start_beat - self.gated_beat).max(0.);
      let cur_frame_expected_start_phase = cur_loop_progress_beats / len_beats;

      let cur_frame_phase_length = self.cached_phase_diff_per_sample * FRAME_SIZE as f32;
      let cur_sample_expected_phase = cur_frame_expected_start_phase
        + cur_frame_phase_length * cur_oversampled_ix_in_frame as f32
          / (FRAME_SIZE * oversample_factor - 1) as f32;
      let cur_sample_expected_phase = cur_sample_expected_phase.max(0.);
      let cur_sample_computed_phase =
        *cur_frame_start_phase + (phase_diff * cur_oversampled_ix_in_frame as f32);

      let mix = cur_oversampled_ix_in_frame as f32 / (FRAME_SIZE * oversample_factor - 1) as f32;
      self.phase = cur_sample_expected_phase * mix + cur_sample_computed_phase * (1. - mix);
    } else {
      if matches!(self.gate_status, GateStatus::Gated) {
        self.phase += phase_diff;
      } else {
        self.phase = (self.phase + phase_diff).min(1.);
      }
    }

    // We are gating and have crossed the release point
    if matches!(self.gate_status, GateStatus::Gated) && self.phase >= self.release_start_phase {
      // Disable the global beat sync if we've reset the loop since we can no longer
      // accurately track things
      *cur_frame_start_phase = -100.;

      if let Some(loop_start) = self.loop_point {
        if self.release_start_phase <= loop_start {
          self.phase = loop_start;
          if let Some(len_beats) = self.len_beats {
            let loop_len_normalized = self.release_start_phase - loop_start;
            let loop_len_beats = loop_len_normalized * len_beats;
            self.gated_beat += loop_len_beats;
          }
          return;
        }
        let overflow_amount = self.phase - self.release_start_phase;
        let loop_size = self.release_start_phase - loop_start;
        self.phase = loop_start + ((overflow_amount / loop_size).fract() * loop_size);
        if let Some(len_beats) = self.len_beats {
          let loop_len_normalized = self.release_start_phase - loop_start;
          let loop_len_beats = loop_len_normalized * len_beats;
          self.gated_beat += loop_len_beats;
        }
      } else {
        // Lock our phase to the release point if we're still gated.  Transitioning to
        // `GateStatus::GatedFrozen` is handled in `render_frame()`.
        self.phase = self.release_start_phase;
      }
    }
  }

  fn get_sample_inner(
    &mut self,
    cur_frame_start_phase: &mut f32,
    cur_frame_start_beat: f32,
    cur_oversampled_ix_in_frame: usize,
    oversample_factor: usize,
  ) -> f32 {
    let sample = match self.gate_status {
      GateStatus::EarlyRelease {
        cur_progress_samples,
        start_x,
        start_y,
        release_start_point_y,
        ..
      } => {
        let early_release_phase =
          (cur_progress_samples as f32) / self.early_release_config.len_samples as f32;

        let early_release_phase_len = self.release_start_phase - start_x;
        self.phase = start_x + early_release_phase * early_release_phase_len;

        match self.early_release_config.strategy {
          EarlyReleaseStrategy::FastEnvelopeFollow => todo!(),
          // `ScanToMatchThenFollow` behaves like `LinearMix` if we don't find a match
          EarlyReleaseStrategy::LinearMix | EarlyReleaseStrategy::ScanToMatchThenFollow =>
            dsp::mix(early_release_phase, release_start_point_y, start_y),
          EarlyReleaseStrategy::Freeze => start_y,
        }
      },
      _ => {
        debug_assert!(self.phase >= 0. && self.phase <= 1.);
        dsp::read_interpolated(
          &*self.rendered,
          self.phase * (RENDERED_BUFFER_SIZE - 2) as f32,
        )
      },
    };

    debug_assert!(sample.is_normal() || sample == 0.);

    self.advance_phase(
      cur_frame_start_phase,
      cur_frame_start_beat,
      cur_oversampled_ix_in_frame,
      oversample_factor,
    );

    sample
  }

  /// Advance the ADSR state by one sample worth and return the output for the current sample.
  ///
  /// Performs oversampling by calling `get_sample_inner()` multiple times and averaging the
  /// results.
  fn get_sample(
    &mut self,
    cur_frame_start_phase: &mut f32,
    cur_frame_start_beat: f32,
    cur_ix_in_frame: usize,
    scale: f32,
    shift: f32,
  ) -> f32 {
    let mut sample = 0.;
    const OVERSAMPLE_FACTOR: usize = 4;
    for i in 0..OVERSAMPLE_FACTOR {
      let cur_oversampled_ix_in_frame = cur_ix_in_frame * OVERSAMPLE_FACTOR + i;
      sample += self.get_sample_inner(
        cur_frame_start_phase,
        cur_frame_start_beat,
        cur_oversampled_ix_in_frame,
        OVERSAMPLE_FACTOR,
      );
    }
    let sample = sample / OVERSAMPLE_FACTOR as f32;
    if self.log_scale {
      sample * 100.
    } else {
      sample * scale + shift
    }
  }

  fn maybe_write_cur_phase(&self) {
    if let Some(write_to_ptr) = self.store_phase_to {
      unsafe { std::ptr::write(write_to_ptr, self.phase) };
    }
  }

  fn fill_buffer_with_value(&mut self, value: f32, scale: f32, shift: f32) {
    let mut frozen_output = value * if self.log_scale { 100. } else { scale + shift };
    if self.log_scale {
      let mut min = shift;
      let max = min + scale;
      if shift == 0. {
        min = if max > 0. { 0.01 } else { -0.01 };
      }

      frozen_output = mk_linear_to_log(min, max, max.signum())(frozen_output);
    }
    for i in 0..FRAME_SIZE {
      self.cur_frame_output[i] = frozen_output;
    }
  }

  /// Populates `self.cur_frame_output` with samples for the current frame
  pub fn render_frame(&mut self, scale: f32, shift: f32, cur_frame_start_beat: f32) {
    let mut cur_frame_start_phase = self.phase;
    match self.gate_status {
      GateStatus::Gated if self.loop_point.is_none() && self.phase >= self.release_start_phase => {
        let final_sample = self.get_sample(
          &mut cur_frame_start_phase,
          cur_frame_start_beat,
          0,
          scale,
          shift,
        );
        self.cur_frame_output.fill(final_sample);
        self.gate_status = if self.early_release_config.strategy == EarlyReleaseStrategy::Freeze {
          GateStatus::Done
        } else {
          GateStatus::GatedFrozen
        };
        self.maybe_write_cur_phase();
        self.maybe_convert_to_log(scale, shift);
        return;
      },
      GateStatus::EarlyRelease {
        start_y, start_x, ..
      } if self.early_release_config.strategy == EarlyReleaseStrategy::Freeze => {
        self.fill_buffer_with_value(start_y, scale, shift);
        self.gate_status = GateStatus::Done;
        self.phase = start_x;
        self.maybe_write_cur_phase();
        return;
      },
      GateStatus::Releasing if self.phase >= 1. => {
        self.phase = 1.;
        self.gate_status = GateStatus::Done;
        // If we are done, we output our final value forever and freeze the output buffer,
        // not requiring any further rendering until we are re-gated
      },
      GateStatus::GatedFrozen | GateStatus::Done => {
        self.maybe_write_cur_phase();
        return;
      },
      _ => (),
    }

    for i in 0..FRAME_SIZE {
      self.cur_frame_output[i] = self.get_sample(
        &mut cur_frame_start_phase,
        cur_frame_start_beat,
        i,
        scale,
        shift,
      );
    }

    self.maybe_write_cur_phase();

    self.maybe_convert_to_log(scale, shift);
  }

  /// If the ADSR is in log_scale mode, then converts all samples in `cur_frame_output` from linear
  /// to log scale
  fn maybe_convert_to_log(&mut self, scale: f32, shift: f32) {
    if self.log_scale {
      let mut min = shift;
      let max = min + scale;
      if shift == 0. {
        min = if max > 0. { 0.001 } else { -0.001 };
      }
      let linear_to_log = mk_linear_to_log(min, max, max.signum());

      for i in 0..FRAME_SIZE {
        self.cur_frame_output[i] = linear_to_log(self.cur_frame_output[i]);
      }
    }
  }

  pub fn get_cur_frame_output(&self) -> &[f32; FRAME_SIZE] { &self.cur_frame_output }

  pub fn set_frozen_output_value(&mut self, new_frozen_output_value: f32, scale: f32, shift: f32) {
    match self.gate_status {
      GateStatus::Done => self.fill_buffer_with_value(new_frozen_output_value, scale, shift),
      _ => (),
    }
  }

  pub fn set_frozen_output_value_from_phase(&mut self, phase: f32, scale: f32, shift: f32) {
    self.gate_status = GateStatus::Done;
    self.phase = phase;
    let new_frozen_output_value =
      dsp::read_interpolated(&*self.rendered, phase * (RENDERED_BUFFER_SIZE - 2) as f32);
    self.fill_buffer_with_value(new_frozen_output_value, scale, shift);
  }

  pub fn set_loop_point(&mut self, new_loop_point: Option<f32>) {
    self.loop_point = new_loop_point;
    // TODO: Do we need to adjust gate status here if we're gated when this happens??  Almost
    // certainly, perhaps other situations as well
  }

  /// After setting steps, the shared buffer must be re-rendered.
  pub fn set_steps(&mut self, new_steps: Vec<AdsrStep>) { self.steps = new_steps; }

  pub fn set_release_start_phase(&mut self, new_release_start_phase: f32) {
    self.release_start_phase = match self.loop_point {
      Some(loop_point) => new_release_start_phase.max(loop_point),
      _ => new_release_start_phase,
    };
  }
}
