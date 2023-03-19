const MAX_VOICE_COUNT: usize = 8;
const FRAME_SIZE: usize = 128;

#[derive(Clone, Copy)]
pub struct Playhead {
  pub pos: f32,
  pub playback_speed: f32,
}

#[derive(Default)]
pub struct CrossfadeParams {
  pub enabled: bool,
  pub threshold: f32,
}

pub struct SampleDescriptor {
  pub sample_buffer: Vec<f32>,
  pub crossfade_params: CrossfadeParams,
  pub crossfaded_sample_buffer: Vec<f32>,
  pub is_gated: bool,
  pub playheads: Vec<Playhead>,
}

impl Default for SampleDescriptor {
  fn default() -> Self {
    SampleDescriptor {
      sample_buffer: Vec::new(),
      crossfade_params: CrossfadeParams::default(),
      crossfaded_sample_buffer: Vec::new(),
      is_gated: false,
      playheads: Vec::new(),
    }
  }
}

impl SampleDescriptor {
  #[inline(never)]
  pub fn get_sample(&mut self) -> f32 {
    let mut sample = 0.;

    let sample_buf = if self.crossfade_params.enabled {
      &self.crossfaded_sample_buffer
    } else {
      &self.sample_buffer
    };

    let mut i = 0;
    while i < self.playheads.len() {
      let mut new_playhead = self.playheads[i];
      new_playhead.pos += new_playhead.playback_speed;
      if new_playhead.pos > (sample_buf.len() - 2) as f32 {
        if self.crossfade_params.enabled {
          new_playhead.pos = new_playhead.pos - (sample_buf.len() - 2) as f32;
        } else {
          self.playheads.swap_remove(i);
          continue;
        }
      }

      self.playheads[i] = new_playhead;
      sample += dsp::read_interpolated(sample_buf, new_playhead.pos);
      i += 1;
    }

    sample
  }
}

#[inline(always)]
fn uninit<T>() -> T { unsafe { std::mem::MaybeUninit::uninit().assume_init() } }

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
      gain_inputs: Box::new(uninit()),
      gate_inputs: Box::new(uninit()),
      output_buffer: Box::new(uninit()),
    }
  }
}

#[no_mangle]
pub extern "C" fn init_sample_player_ctx() -> *mut SamplePlayerCtx {
  Box::into_raw(Box::new(SamplePlayerCtx::default()))
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

fn gen_crossfaded_sample_buffer(sample_buffer: &[f32], threshold: f32) -> Vec<f32> {
  let half_threshold = threshold / 2.;
  let mut crossfaded_sample_buffer = Vec::with_capacity(sample_buffer.len());
  let sample_count = sample_buffer.len() as f32;

  for i in 0..sample_buffer.len() {
    let sample = if i < (half_threshold * sample_count) as usize {
      let factor = i as f32 / (half_threshold * sample_count);
      let base_sample = sample_buffer[i] * factor;
      let other_end_ix = sample_buffer.len() - i - 1;
      let other_end_sample = sample_buffer[other_end_ix] * (1. - factor);
      base_sample + other_end_sample
    } else if i > (sample_count - half_threshold * sample_count) as usize {
      let factor = (sample_buffer.len() - i) as f32 / (half_threshold * sample_count);
      let base_sample = sample_buffer[i] * factor;
      let other_end_ix = sample_buffer.len() - i - 1;
      let other_end_sample = sample_buffer[other_end_ix] * (1. - factor);
      base_sample + other_end_sample
    } else {
      sample_buffer[i]
    };
    crossfaded_sample_buffer.push(sample);
  }

  crossfaded_sample_buffer
}

#[no_mangle]
pub extern "C" fn set_sample_crossfade_params(
  ctx: *mut SamplePlayerCtx,
  voice_ix: usize,
  enabled: bool,
  threshold: f32,
) {
  let ctx = unsafe { &mut *ctx };

  if ctx.voices.get(voice_ix).is_none() {
    panic!(
      "Tried to set crossfade params for sample at index={} but only {} samples exist",
      voice_ix,
      ctx.voices.len()
    );
  }

  let voice = &mut ctx.voices[voice_ix];
  voice.crossfade_params.enabled = enabled;
  voice.crossfade_params.threshold = threshold;

  if enabled && voice.sample_buffer.len() > 0 {
    voice.crossfaded_sample_buffer = gen_crossfaded_sample_buffer(&voice.sample_buffer, threshold);
  }
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

#[no_mangle]
pub extern "C" fn on_sample_data_set(ctx: *mut SamplePlayerCtx, sample_ix: usize) {
  let ctx = unsafe { &mut *ctx };
  let sample = &mut ctx.voices[sample_ix];

  if sample.crossfade_params.enabled {
    sample.crossfaded_sample_buffer =
      gen_crossfaded_sample_buffer(&sample.sample_buffer, sample.crossfade_params.threshold);
  }
}
