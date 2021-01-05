#![feature(box_syntax)]

const SAMPLE_RATE: usize = 44_100;
const RENDERED_BUFFER_SIZE: usize = SAMPLE_RATE * 8;

pub enum RampFn {
    Instant,
    Linear,
    Exponential { exponent: f32 },
}

fn compute_pos(prev_step: &ADSRStep, next_step: &ADSRStep, phase: f32) -> f32 {
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
            let distance = next_step.x - prev_step.x;
            let x = (phase - prev_step.x) / distance;
            // TODO: Look into replacing this with faster version if accuracy is good enough
            x.powf(exponent) * y_diff
        },
    }
}

pub struct ADSRStep {
    pub x: f32,
    pub y: f32,
    pub ramper: RampFn,
}

pub struct ADSR {
    /// From 0 to 1 representing position in the ADSR from start to end
    phase: f32,
    steps: Vec<ADSRStep>,
    /// If provided, once the ADSR hits point `loop_points.1`, it will loop back to `loop_points.0`
    /// forever.
    loop_points: Option<(f32, f32)>,
    rendered: Box<[f32; RENDERED_BUFFER_SIZE]>,
    len_samples: f32,
    /// Optimization to avoid having to do some math in the hot path.  Always should be equal to
    /// `(1 / len_samples) `
    cached_phase_diff_per_sample: f32,
}

const DEFAULT_FIRST_STEP: ADSRStep = ADSRStep {
    x: 0.,
    y: 0.,
    ramper: RampFn::Instant,
};

impl ADSR {
    pub fn new(steps: Vec<ADSRStep>, loop_points: Option<(f32, f32)>, len_samples: f32) -> Self {
        let mut inst = ADSR {
            phase: 0.,
            steps,
            loop_points,
            rendered: box unsafe { std::mem::MaybeUninit::uninit().assume_init() },
            len_samples,
            cached_phase_diff_per_sample: (1. / len_samples),
        };
        inst.render();
        inst
    }

    fn render(&mut self) {
        let mut prev_step_opt: Option<&ADSRStep> = None;
        let mut next_step_opt: Option<&ADSRStep> = self.steps.get(0);
        let mut next_step_ix = 0usize;

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

            let next_step = match next_step_opt.as_mut() {
                Some(step) => step,
                None => {
                    // If there are no more steps and an end step isn't provided, we just hold the
                    // value from the last step we have
                    self.rendered[i] = prev_step_opt.map(|step| step.y).unwrap_or(0.);
                    continue;
                },
            };

            let prev_step = prev_step_opt.unwrap_or(&DEFAULT_FIRST_STEP);
            self.rendered[i] = compute_pos(prev_step, next_step, phase);
        }
    }

    pub fn set_len_samples(&mut self, new_len_samples: f32) {
        self.len_samples = new_len_samples;
        self.cached_phase_diff_per_sample = 1. / new_len_samples;
    }

    /// Advance phase by one sample's worth
    fn advance_phase(&mut self) {
        self.phase += self.cached_phase_diff_per_sample;
        if let Some((loop_start, loop_end)) = self.loop_points {
            if self.phase > loop_end {
                let overflow_amount = self.phase - loop_end;
                let loop_size = loop_end - loop_start;
                self.phase = loop_start + (overflow_amount / loop_size).trunc();
            }
        } else {
            self.phase = self.phase.trunc();
        }
    }

    /// Advance the ADSR state by one sample worth and return the output for the current sample
    pub fn get_sample(&mut self) -> f32 {
        self.advance_phase();

        dsp::read_interpolated(
            &*self.rendered,
            self.phase * (RENDERED_BUFFER_SIZE - 1) as f32,
        )
    }

    pub fn set_loop_points(&mut self, new_loop_points: Option<(f32, f32)>) {
        self.loop_points = new_loop_points;
    }

    pub fn set_steps(&mut self, new_steps: Vec<ADSRStep>) {
        self.steps = new_steps;
        self.render();
    }
}
