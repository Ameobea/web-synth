#![feature(box_syntax)]

const FRAME_SIZE: usize = 128;

pub struct ReverseState {
    pub is_reversed: bool,
}

impl Default for ReverseState {
    fn default() -> Self { ReverseState { is_reversed: false } }
}

pub struct GranularCtx {
    pub waveform: Vec<f32>,
    pub rendered_output: [f32; FRAME_SIZE],
    pub reversed: ReverseState,
    /// The index at which the current grain starts in the waveform buffer, offset from the
    /// start of the grain
    pub cur_grain_start: f32,
    /// The offset from `cur_grain_start` at which the latest sample will be read
    pub cur_sample_offset: f32,
    pub last_sample: f32,
}

impl Default for GranularCtx {
    fn default() -> Self {
        GranularCtx {
            waveform: Vec::new(),
            rendered_output: [0.0; FRAME_SIZE],
            reversed: Default::default(),
            cur_grain_start: 0.0,
            cur_sample_offset: 0.0,
            last_sample: 0.0,
        }
    }
}

impl GranularCtx {
    /// Moves the internal buffer position variables to their next values for the next sample to be
    /// read
    pub fn advance_pointers(
        &mut self,
        grain_size: f32,
        grain_speed_ratio: f32,
        sample_speed_ratio: f32,
        start_sample_ix: usize,
        end_sample_ix: usize,
    ) -> bool {
        let selection_len = end_sample_ix - start_sample_ix;

        let mut new_sample_offset = self.cur_sample_offset + sample_speed_ratio;

        // If we've moved past the end of the grain, we move the start of the grain according to the
        // grain speed ratio
        let (did_wrap, new_grain_start) = if new_sample_offset > grain_size {
            new_sample_offset = new_sample_offset % grain_size;
            let new_grain_start = self.cur_grain_start + (grain_speed_ratio * grain_size);

            // If our new grain start has moved past the end of the selection, we need to loop
            // it back around
            (true, new_grain_start % selection_len as f32)
        } else {
            (false, self.cur_grain_start)
        };

        // Our new sample offset must be inside the grain, and the index must be within the bounds
        // of the selection
        assert!(new_sample_offset <= grain_size);

        self.cur_grain_start = new_grain_start;
        self.cur_sample_offset = new_sample_offset;
        did_wrap
    }

    pub fn get_volume(&self) -> f32 {
        1.0 // TODO
    }

    /// Reads a sample out of the waveform according to `self.i`, interpolating as necessary and
    /// handling wrap-arounds.  Also applies the volume envelope.
    pub fn get_sample(&self, start_sample_ix: usize, end_sample_ix: usize) -> (bool, f32) {
        let selection_len = end_sample_ix - start_sample_ix;

        // This is relative to `start_sample_ix`, and we wrap around in case that the current grain
        // extends beyond the end of our selection
        let mut i = self.cur_grain_start + self.cur_sample_offset;
        let did_wrap = i > selection_len as f32;
        i = i % selection_len as f32;
        let base_sample_ix = i.trunc() as usize;
        // This is also relative to `start_sample_ix`
        let mut next_sample_ix = base_sample_ix + 1;
        if next_sample_ix > selection_len {
            next_sample_ix = 0;
        }
        let interpolation_mix = i.fract();

        (
            did_wrap,
            (self.waveform[start_sample_ix + base_sample_ix] * interpolation_mix
                + (self.waveform[start_sample_ix + next_sample_ix] * (1.0 - interpolation_mix)))
                * self.get_volume(),
        )
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

#[no_mangle]
pub fn set_is_reversed(ctx: *mut GranularCtx, is_reversed: bool) {
    unsafe {
        (*ctx).reversed.is_reversed = is_reversed;
    }
}

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
        let did_wrap = ctx.advance_pointers(
            grain_size,
            grain_speed_ratio,
            sample_speed_ratio,
            start_sample_ix,
            end_sample_ix,
        );
        let (did_wrap_2, sample) = ctx.get_sample(start_sample_ix, end_sample_ix);
        ctx.rendered_output[i] = sample;
        if did_wrap || did_wrap_2 {
            ctx.rendered_output[i] = ctx.last_sample * 0.5 + ctx.rendered_output[i] * 0.5;
        }
        ctx.last_sample = ctx.rendered_output[i];
    }

    ctx.rendered_output.as_ptr()
}
