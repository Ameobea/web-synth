const SAMPLE_RATE: usize = 44_100;
const FRAME_SIZE: usize = 128;
const MAX_DELAY_MS: usize = 60 * 1000;
const MAX_DELAY_SAMPLES: usize = MAX_DELAY_MS * (SAMPLE_RATE / 1000);

pub struct DelayCtx {
    pub delay_line: dsp::circular_buffer::CircularBuffer<MAX_DELAY_SAMPLES>,
    pub main_io_buffer: Box<[f32; FRAME_SIZE]>,
    pub delay_output_buffer: Box<[f32; FRAME_SIZE]>,
    // Params
    pub delay_ms: Box<[f32; FRAME_SIZE]>,
    pub delay_gain: Box<[f32; FRAME_SIZE]>,
    pub feedback: Box<[f32; FRAME_SIZE]>,
}

#[no_mangle]
pub extern "C" fn init_delay_ctx() -> *mut DelayCtx {
    let delay_ctx = DelayCtx {
        delay_line: dsp::circular_buffer::CircularBuffer::new(),
        main_io_buffer: Box::new(unsafe { std::mem::MaybeUninit::uninit().assume_init() }),
        delay_output_buffer: Box::new(unsafe { std::mem::MaybeUninit::uninit().assume_init() }),
        delay_ms: Box::new(unsafe { std::mem::MaybeUninit::uninit().assume_init() }),
        delay_gain: Box::new(unsafe { std::mem::MaybeUninit::uninit().assume_init() }),
        feedback: Box::new(unsafe { std::mem::MaybeUninit::uninit().assume_init() }),
    };
    Box::into_raw(Box::new(delay_ctx))
}

#[no_mangle]
pub unsafe extern "C" fn get_main_io_buffer_ptr(ctx: *mut DelayCtx) -> *mut f32 {
    (*(*ctx).main_io_buffer).as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn get_delay_output_buffer_ptr(ctx: *mut DelayCtx) -> *mut f32 {
    (*(*ctx).delay_output_buffer).as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn get_delay_ms_ptr(ctx: *mut DelayCtx) -> *mut f32 {
    (*(*ctx).delay_ms).as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn get_delay_gain_ptr(ctx: *mut DelayCtx) -> *mut f32 {
    (*(*ctx).delay_gain).as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn get_feedback_ptr(ctx: *mut DelayCtx) -> *mut f32 {
    (*(*ctx).feedback).as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn process_delay(ctx: *mut DelayCtx) {
    let ctx = unsafe { &mut *ctx };

    for sample_ix in 0..ctx.main_io_buffer.len() {
        let sample = ctx.main_io_buffer[sample_ix];
        let delay_ms = ctx.delay_ms[sample_ix];
        let delay_gain = ctx.delay_gain[sample_ix];
        let feedback = ctx.feedback[sample_ix];

        let delay_samples = delay_ms * (1. / 1000.) * SAMPLE_RATE as f32;
        let delayed_sample = ctx.delay_line.read_interpolated(-delay_samples);
        ctx.delay_line.set(sample + delayed_sample * feedback);
        ctx.delay_output_buffer[sample_ix] = delayed_sample;
        ctx.main_io_buffer[sample_ix] = sample + delayed_sample * delay_gain;
    }
}
