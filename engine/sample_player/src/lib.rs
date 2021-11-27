#![feature(box_syntax)]

const MAX_VOICE_COUNT: usize = 8;
const FRAME_SIZE: usize = 128;

#[derive(Clone, Copy)]
pub struct Playhead {
    pub pos: f32,
    pub playback_speed: f32,
}

pub struct SampleDescriptor {
    pub sample_buffer: Vec<f32>,
    pub is_gated: bool,
    pub playheads: Vec<Playhead>,
}

impl Default for SampleDescriptor {
    fn default() -> Self {
        SampleDescriptor {
            sample_buffer: Vec::new(),
            is_gated: true,
            playheads: Vec::new(),
        }
    }
}

impl SampleDescriptor {
    pub fn get_sample(&mut self) -> f32 {
        let mut sample = 0.;

        let mut i = 0;
        while i < self.playheads.len() {
            let mut new_playhead = self.playheads[i];
            new_playhead.pos += new_playhead.playback_speed;
            if new_playhead.pos > (self.sample_buffer.len() - 1) as f32 {
                self.playheads.swap_remove(i);
                continue;
            }

            self.playheads[i] = new_playhead;
            sample += dsp::read_interpolated(&self.sample_buffer, new_playhead.pos);
            i += 1;
        }

        sample
    }
}

pub struct SamplePlayerCtx {
    pub voices: Vec<SampleDescriptor>,
    pub gain_inputs: Box<[[f32; FRAME_SIZE]; MAX_VOICE_COUNT]>,
    pub gate_inputs: Box<[[f32; FRAME_SIZE]; MAX_VOICE_COUNT]>,
    pub output_buffer: Box<[f32; FRAME_SIZE]>,
}

impl Default for SamplePlayerCtx {
    fn default() -> Self {
        SamplePlayerCtx {
            voices: Vec::with_capacity(MAX_VOICE_COUNT),
            gain_inputs: box unsafe { std::mem::MaybeUninit::uninit().assume_init() },
            gate_inputs: box unsafe { std::mem::MaybeUninit::uninit().assume_init() },
            output_buffer: box unsafe { std::mem::MaybeUninit::uninit().assume_init() },
        }
    }
}

#[no_mangle]
pub extern "C" fn init_sample_player_ctx() -> *mut SamplePlayerCtx {
    Box::into_raw(box SamplePlayerCtx::default())
}

#[no_mangle]
pub extern "C" fn get_gain_params_ptr(ctx: *mut SamplePlayerCtx) -> *mut [f32; FRAME_SIZE] {
    unsafe { (*ctx).gain_inputs.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn get_gate_params_ptr(ctx: *mut SamplePlayerCtx) -> *mut [f32; FRAME_SIZE] {
    unsafe { (*ctx).gate_inputs.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn get_output_buffer_ptr(ctx: *const SamplePlayerCtx) -> *const f32 {
    unsafe { (*ctx).output_buffer.as_ptr() }
}

#[no_mangle]
pub extern "C" fn process_sample_player(ctx: *mut SamplePlayerCtx) {
    let ctx = unsafe { &mut *ctx };
    ctx.output_buffer.fill(0.);

    for voice_ix in 0..ctx.voices.len() {
        let gain_inputs = &ctx.gain_inputs[voice_ix];
        let gate_inputs = &ctx.gate_inputs[voice_ix];
        let voice = &mut ctx.voices[voice_ix];
        if voice.sample_buffer.len() <= 5 {
            continue;
        }

        for sample_ix in 0..FRAME_SIZE {
            let is_gated = gate_inputs[sample_ix] > 0.;
            if is_gated && !voice.is_gated {
                voice.is_gated = true;
                voice.playheads.push(Playhead {
                    pos: 0.,
                    playback_speed: 1.,
                });
            } else if !is_gated && voice.is_gated {
                voice.is_gated = false;
            }

            let sample = voice.get_sample();
            let gain = gain_inputs[sample_ix];
            ctx.output_buffer[sample_ix] += sample * gain;
        }
    }
}

#[no_mangle]
pub extern "C" fn add_sample(ctx: *mut SamplePlayerCtx, _gain: f32) {
    let ctx = unsafe { &mut *ctx };

    if ctx.voices.len() > MAX_VOICE_COUNT {
        panic!("Tried to add more samples than the maximum");
    }

    ctx.voices.push(Default::default());
}

#[no_mangle]
pub extern "C" fn remove_sample(ctx: *mut SamplePlayerCtx, voice_ix: usize) {
    let ctx = unsafe { &mut *ctx };

    if ctx.voices.get(voice_ix).is_none() {
        panic!(
            "Tried to remove sample at index={} but only {} samples exist",
            voice_ix,
            ctx.voices.len()
        );
    }

    ctx.voices.remove(voice_ix);
}

#[no_mangle]
pub extern "C" fn get_sample_buf_ptr(
    ctx: *mut SamplePlayerCtx,
    sample_ix: usize,
    sample_len_samples: usize,
) -> *mut f32 {
    let ctx = unsafe { &mut *ctx };
    let sample = &mut ctx.voices[sample_ix];

    if sample.sample_buffer.len() < sample_len_samples {
        sample
            .sample_buffer
            .reserve(sample_len_samples - sample.sample_buffer.len());
    }
    unsafe { sample.sample_buffer.set_len(sample_len_samples) };
    sample.playheads.clear();

    sample.sample_buffer.as_mut_ptr()
}