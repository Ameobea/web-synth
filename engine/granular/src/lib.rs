#![feature(box_syntax)]

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

#[derive(Clone, Copy)]
pub struct GranularVoice {
    /// The index at which the current grain starts in the waveform buffer, offset from the
    /// start of the grain
    pub cur_grain_start: f32,
    pub last_sample: f32,
    pub reversed: ReverseState,
    // It may be better to make these something that is provided directly per-voice in the future
    pub pos_scale: f32,
    pub pos_shift: f32,
    pos_grain_size_mult: f32,
}

impl Default for GranularVoice {
    fn default() -> Self {
        GranularVoice {
            cur_grain_start: 0.0,
            last_sample: 0.0,
            reversed: ReverseState::default(),
            pos_scale: 1.0,
            pos_shift: 0.0,
            pos_grain_size_mult: 0.0,
        }
    }
}

pub struct GranularCtx {
    pub waveform: Vec<f32>,
    /// The offset from `cur_grain_start` at which the latest sample will be read
    pub cur_sample_offset: f32,
    pub rendered_output: [f32; FRAME_SIZE],
    pub voices: [GranularVoice; 2],
}

impl Default for GranularCtx {
    fn default() -> Self {
        let mut voices = [GranularVoice::default(); 2];
        voices[1].pos_grain_size_mult = 0.5;
        voices[1].pos_scale = 1.33;
        // voices[1].reversed.grain_is_reversed = true;
        // voices[1].reversed.grain_movement_is_reversed = true;

        GranularCtx {
            waveform: Vec::new(),
            cur_sample_offset: 0.0,
            rendered_output: [0.0; FRAME_SIZE],
            voices,
        }
    }
}

impl GranularVoice {
    /// Reads a sample out of the waveform according to `self.i`, interpolating as necessary and
    /// handling wrap-arounds.
    pub fn get_sample(
        &self,
        waveform: &[f32],
        start_sample_ix: usize,
        end_sample_ix: usize,
        cur_sample_offset: f32,
        grain_size: f32,
    ) -> f32 {
        let selection_len = end_sample_ix - start_sample_ix;

        let offset_from_start_of_grain =
            (self.pos_grain_size_mult * grain_size) + cur_sample_offset;
        // Constrain within the grain
        let offset_from_start_of_grain = if self.reversed.grain_is_reversed {
            1. - (offset_from_start_of_grain % grain_size)
        } else {
            offset_from_start_of_grain % grain_size
        };
        let i = (self.cur_grain_start * self.pos_scale) + offset_from_start_of_grain;
        let offset_from_start_sample_ix = i - start_sample_ix as f32;
        // Constrain within the selection
        let offset_from_start_sample_ix = offset_from_start_sample_ix % selection_len as f32;
        let i = start_sample_ix as f32 + offset_from_start_sample_ix;

        let base_sample_ix = i.trunc() as usize;
        let interpolation_mix = i.fract();
        assert!(base_sample_ix < end_sample_ix);
        // This is also relative to `start_sample_ix`
        let next_sample_ix =
            start_sample_ix + ((base_sample_ix - start_sample_ix + 1) % selection_len);

        waveform[base_sample_ix] * interpolation_mix
            + (waveform[next_sample_ix] * (1.0 - interpolation_mix))
    }
}

impl GranularCtx {
    pub fn advance_pointers(
        &mut self,
        grain_size: f32,
        // This should be voice-specific
        grain_speed_ratio: f32,
        // This should be voice-specific
        sample_speed_ratio: f32,
        start_sample_ix: usize,
        end_sample_ix: usize,
    ) {
        let selection_len = end_sample_ix - start_sample_ix;
        let new_sample_offset = (self.cur_sample_offset + sample_speed_ratio) % grain_size;

        // If we've moved past the end of the grain, we move the start of the grain according to the
        // grain speed ratio
        for voice in &mut self.voices {
            let reset_threshold =
                ((voice.pos_grain_size_mult * grain_size) + grain_size) % grain_size;
            let crossed = (self.cur_sample_offset < reset_threshold
                && new_sample_offset > reset_threshold)
                || (new_sample_offset < self.cur_sample_offset
                    && (reset_threshold > self.cur_sample_offset
                        || reset_threshold < new_sample_offset));

            if crossed {
                // If our new grain start has moved past the end of the selection, we need to loop
                // it back around
                let new_grain_start = voice.cur_grain_start + (grain_speed_ratio * grain_size);
                voice.cur_grain_start = new_grain_start % selection_len as f32
            }
        }

        // Our new sample offset must be inside the grain, and the index must be within the bounds
        // of the selection
        assert!(new_sample_offset <= grain_size);

        self.cur_sample_offset = new_sample_offset;
    }

    pub fn get_volume(&self, grain_size: f32) -> f32 {
        // TODO: Slope Width
        let pct = self.cur_sample_offset / grain_size;
        // if pct < 0.5 {
        //     0.3 * (1.4 * pct)
        // } else {
        //     1. - ((pct - 0.5) * 1.4)
        // }
        (pct * std::f32::consts::PI).sin()
    }

    pub fn get_sample(&self, start_sample_ix: usize, end_sample_ix: usize, grain_size: f32) -> f32 {
        let v1_volume = self.get_volume(grain_size);
        let v2_volume = 1.0 - v1_volume;

        let v1_sample = self.voices[0].get_sample(
            &self.waveform,
            start_sample_ix,
            end_sample_ix,
            self.cur_sample_offset,
            grain_size,
        );
        let v2_sample = self.voices[1].get_sample(
            &self.waveform,
            start_sample_ix,
            end_sample_ix,
            self.cur_sample_offset,
            grain_size,
        );
        (v1_sample * v1_volume * 0.9) + (v2_sample * v2_volume * 0.9)
    }
}

#[no_mangle]
pub fn create_granular_instance() -> *mut GranularCtx {
    let ctx = box GranularCtx::default();
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
    mut start_sample_ix: usize,
    mut end_sample_ix: usize,
    grain_size: f32,
    grain_speed_ratio: f32,
    mut sample_speed_ratio: f32,
) -> *const f32 {
    let ctx = unsafe { &mut *ctx };

    // sample speed ratio can't be larger than the grain size
    if sample_speed_ratio > grain_size {
        sample_speed_ratio = grain_size;
    }

    // End sample can't be less than start sample
    if end_sample_ix < start_sample_ix {
        end_sample_ix = start_sample_ix;
    }

    // Start and end samples must be within the waveform
    if end_sample_ix >= ctx.waveform.len() {
        end_sample_ix = ctx.waveform.len() - 1;
    }
    if start_sample_ix >= ctx.waveform.len() {
        start_sample_ix = ctx.waveform.len() - 1;
    }

    for i in 0..FRAME_SIZE {
        ctx.advance_pointers(
            grain_size,
            grain_speed_ratio,
            sample_speed_ratio,
            start_sample_ix,
            end_sample_ix,
        );
        let sample = ctx.get_sample(start_sample_ix, end_sample_ix, grain_size);
        ctx.rendered_output[i] = sample;
    }

    ctx.rendered_output.as_ptr()
}
