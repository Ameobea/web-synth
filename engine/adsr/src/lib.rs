#![feature(box_syntax, get_mut_unchecked)]

use std::rc::Rc;

use dsp::even_faster_pow;

#[cfg(feature = "exports")]
pub mod exports;

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
            // prev_step.y + x.powf(exponent) * y_diff
            prev_step.y + even_faster_pow(x, exponent) * y_diff
        },
    }
}

#[derive(Clone, Copy)]
pub struct AdsrStep {
    pub x: f32,
    pub y: f32,
    pub ramper: RampFn,
}

#[derive(Clone, Copy, PartialEq)]
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
#[derive(Clone)]
pub enum EarlyReleaseStrategy {
    /// We mix linearly between the start value (value of the ADSR when it was released) and the
    /// value at the release point linearly
    LinearMix,
    /// We follow the ADSR's envelope at an increased speed, bridging the gap between the point at
    /// which the ADSR was released and the release point in `len_samples` samples
    FastEnvelopeFollow,
}

/// Determines how we handle releasing if the ADSR is ungated before the release point
#[derive(Clone)]
pub struct EarlyReleaseConfig {
    pub strategy: EarlyReleaseStrategy,
    pub len_samples: usize,
}

impl Default for EarlyReleaseConfig {
    fn default() -> Self {
        EarlyReleaseConfig {
            strategy: EarlyReleaseStrategy::LinearMix,
            len_samples: 2_640,
        }
    }
}

#[derive(Clone)]
pub struct Adsr {
    /// From 0 to 1 representing position in the ADSR from start to end
    pub phase: f32,
    pub gate_status: GateStatus,
    /// Point at which the decay begins.
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
    /// Optimization to avoid having to do some math in the hot path.  Always should be equal to
    /// `(1 / len_samples) `
    cached_phase_diff_per_sample: f32,
    /// If set, whenever the ADSR is updated, the most recent phase will be written to this
    /// pointer.  This is used to facilitate rendering of ADSRs in the UI by sharing some memory
    /// containing the current phase of all active ADSRs.
    pub store_phase_to: Option<*mut f32>,
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
        release_start_phase: f32,
        rendered: Rc<[f32; RENDERED_BUFFER_SIZE]>,
        early_release_config: EarlyReleaseConfig,
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
            cur_frame_output: box unsafe { std::mem::MaybeUninit::uninit().assume_init() },
            len_samples,
            cached_phase_diff_per_sample: (1. / len_samples),
            store_phase_to: None,
        }
    }

    pub fn gate(&mut self) {
        self.phase = 0.;
        self.gate_status = GateStatus::Gated;
    }

    pub fn ungate(&mut self) {
        if self.phase < self.release_start_phase {
            self.gate_status = GateStatus::EarlyRelease {
                start_x: self.phase,
                start_y: dsp::read_interpolated(
                    &*self.rendered,
                    self.phase * (RENDERED_BUFFER_SIZE - 2) as f32,
                ),
                release_start_point_y: dsp::read_interpolated(
                    &*self.rendered,
                    self.release_start_phase * (RENDERED_BUFFER_SIZE - 2) as f32,
                ),
                cur_progress_samples: 0,
            };
        } else {
            self.phase = self.release_start_phase;
            self.gate_status = GateStatus::Releasing;
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

    pub fn set_len_samples(&mut self, new_len_samples: f32) {
        self.len_samples = new_len_samples;
        self.cached_phase_diff_per_sample = 1. / new_len_samples;
    }

    /// Advance phase by one sample's worth
    ///
    /// TODO: Fastpath this if we are not close to hitting the decay point (if gated) or the end of
    /// the waveform (if released)
    fn advance_phase(&mut self) {
        if let GateStatus::EarlyRelease {
            cur_progress_samples,
            ..
        } = &mut self.gate_status
        {
            *cur_progress_samples += 1;
            if *cur_progress_samples <= self.early_release_config.len_samples {
                return;
            } else {
                self.phase = self.release_start_phase;
                self.gate_status = GateStatus::Releasing;
            }
        }

        self.phase = (self.phase + self.cached_phase_diff_per_sample).min(1.);

        // We are gating and have crossed the release point
        if self.gate_status == GateStatus::Gated && self.phase >= self.release_start_phase {
            if let Some(loop_start) = self.loop_point {
                if self.release_start_phase <= loop_start {
                    self.phase = loop_start;
                    return;
                }
                let overflow_amount = self.phase - self.release_start_phase;
                let loop_size = self.release_start_phase - loop_start;
                self.phase = loop_start + ((overflow_amount / loop_size).fract() * loop_size);
            } else {
                // Lock our phase to the release point if we're still gated.  Transitioning to
                // `GateStatus::GatedFrozen` is handled in `render_frame()`.
                self.phase = self.release_start_phase;
            }
        }
    }

    /// Advance the ADSR state by one sample worth and return the output for the current sample
    fn get_sample(&mut self) -> f32 {
        self.advance_phase();

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
                    EarlyReleaseStrategy::LinearMix =>
                        dsp::mix(early_release_phase, release_start_point_y, start_y),
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
        sample
    }

    fn maybe_write_cur_phase(&self) {
        if let Some(write_to_ptr) = self.store_phase_to {
            unsafe { std::ptr::write(write_to_ptr, self.phase) };
        }
    }

    /// Populates `self.cur_frame_output` with samples for the current frame
    pub fn render_frame(&mut self, scale: f32, shift: f32) {
        match self.gate_status {
            GateStatus::Gated
                if self.loop_point.is_none() && self.phase >= self.release_start_phase =>
            {
                // No loop point, so we freeze the output value and avoid re-rendering until after
                // ungating
                let frozen_output = self.get_sample() * scale + shift;
                for i in 0..FRAME_SIZE {
                    self.cur_frame_output[i] = frozen_output;
                }
                self.gate_status = GateStatus::GatedFrozen;
                self.maybe_write_cur_phase();
                return;
            }
            GateStatus::Releasing if self.phase >= 1. => {
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
            self.cur_frame_output[i] = self.get_sample() * scale + shift;
        }
        self.maybe_write_cur_phase();
    }

    pub fn get_cur_frame_output(&self) -> &[f32; FRAME_SIZE] { &self.cur_frame_output }

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
