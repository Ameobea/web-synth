use dsp::filters::butterworth::ButterworthFilter;

const SAMPLE_RATE: usize = 44_100;
const FRAME_SIZE: usize = 128;
const MAX_DELAY_MS: usize = 60 * 1000;
const MAX_DELAY_SAMPLES: usize = MAX_DELAY_MS * (SAMPLE_RATE / 1000);

pub struct DelayCtx {
  pub delay_line: dsp::circular_buffer::CircularBuffer<MAX_DELAY_SAMPLES>,
  pub main_io_buffer: Box<[f32; FRAME_SIZE]>,
  pub delay_output_buffer: Box<[f32; FRAME_SIZE]>,
  // Params
  pub last_delay_ms: f32,
  pub delay_ms: Box<[f32; FRAME_SIZE]>,
  pub last_delay_gain: f32,
  pub delay_gain: Box<[f32; FRAME_SIZE]>,
  pub last_feedback: f32,
  pub feedback: Box<[f32; FRAME_SIZE]>,
  pub last_highpass_cutoff: f32,
  pub highpass_cutoff: Box<[f32; FRAME_SIZE]>,
  pub highpass_filter: ButterworthFilter,
}

#[inline(always)]
fn uninit<T>() -> T { unsafe { std::mem::MaybeUninit::uninit().assume_init() } }

#[no_mangle]
pub extern "C" fn init_delay_ctx() -> *mut DelayCtx {
  let delay_ctx = DelayCtx {
    delay_line: dsp::circular_buffer::CircularBuffer::new(),
    main_io_buffer: Box::new(uninit()),
    delay_output_buffer: Box::new(uninit()),
    last_delay_ms: 0.,
    delay_ms: Box::new(uninit()),
    last_delay_gain: 0.,
    delay_gain: Box::new(uninit()),
    last_feedback: 0.,
    feedback: Box::new(uninit()),
    last_highpass_cutoff: 0.,
    highpass_cutoff: Box::new(uninit()),
    highpass_filter: ButterworthFilter::default(),
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
pub unsafe extern "C" fn get_highpass_cutoff_ptr(ctx: *mut DelayCtx) -> *mut f32 {
  (*(*ctx).highpass_cutoff).as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn process_delay(ctx: *mut DelayCtx) {
  let ctx = unsafe { &mut *ctx };

  for sample_ix in 0..ctx.main_io_buffer.len() {
    let sample = ctx.main_io_buffer[sample_ix];
    let delay_ms = dsp::smooth(&mut ctx.last_delay_ms, ctx.delay_ms[sample_ix], 0.99);
    let delay_gain = dsp::smooth(&mut ctx.last_delay_gain, ctx.delay_gain[sample_ix], 0.99);
    let feedback = dsp::smooth(&mut ctx.last_feedback, ctx.feedback[sample_ix], 0.99);
    let highpass_cutoff = dsp::smooth(
      &mut ctx.last_highpass_cutoff,
      ctx.highpass_cutoff[sample_ix],
      0.99,
    );

    let delay_samples = delay_ms * (1. / 1000.) * SAMPLE_RATE as f32;
    let delayed_sample = ctx.delay_line.read_interpolated(-delay_samples);
    let highpassed_sample = ctx.highpass_filter.highpass(highpass_cutoff, sample);
    ctx
      .delay_line
      .set(highpassed_sample + delayed_sample * feedback);
    ctx.delay_output_buffer[sample_ix] = delayed_sample;
    ctx.main_io_buffer[sample_ix] = sample + delayed_sample * delay_gain;
  }
}
