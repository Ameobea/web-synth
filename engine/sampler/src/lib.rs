use dsp::FRAME_SIZE;

#[derive(Clone, Copy)]
pub struct CrossfadeConfig {
  /// How many samples are in the crossfade at the start of the grain playback.  The reverse flag
  /// of the grain doesn't affect this.
  pub start_len_samples: f32,
  /// How many samples are in the crossfade at the end of the grain playback. The reverse flag of
  /// the grain doesn't affect this.
  pub end_len_samples: f32,
}

impl CrossfadeConfig {
  pub fn get_amp_factor(&self, grain_phase: f32, grain_len_samples: f32) -> f32 {
    let crossfade_in_phase =
      dsp::smoothstep(0., self.start_len_samples / grain_len_samples, grain_phase);
    let crossfade_out_phase = dsp::smoothstep(
      1. - self.end_len_samples / grain_len_samples,
      1.,
      grain_phase,
    );

    crossfade_in_phase * (1. - crossfade_out_phase)
  }
}

#[derive(Clone)]
pub struct GrainConfig {
  /// The sample index in the sample data where the grain starts.  This is always less than
  /// `end_sample_ix`, even if the grain is reversed.
  pub start_sample_ix: f32,
  pub end_sample_ix: f32,
  pub crossfade: CrossfadeConfig,
  pub playback_rate: f32,
  pub reverse: bool,
}

pub struct Grain {
  pub config: GrainConfig,
  /// Value [0, 1] representing how far through the grain we are.  This goes from 0 to 1 regardless
  /// of whether the grain is playing forwards or backwards.
  pub phase: f32,
}

impl Grain {
  /// Process the grain, adding its output for the current frame to the output buffer.
  ///
  /// If the grain is done playing, returns `true`.
  pub fn process(&mut self, sample_data: &[f32], output: &mut [f32]) -> bool {
    let GrainConfig {
      start_sample_ix: grain_start_sample_ix,
      end_sample_ix: grain_end_sample_ix,
      ref crossfade,
      playback_rate,
      reverse,
    } = self.config;

    let grain_len_samples = grain_end_sample_ix - grain_start_sample_ix;
    let played_samples_per_frame = playback_rate * FRAME_SIZE as f32;
    let grain_len_frames = grain_len_samples / played_samples_per_frame;

    let frame_start_sample_ix = dsp::mix(
      if !reverse {
        1. - self.phase
      } else {
        self.phase
      },
      grain_start_sample_ix,
      grain_end_sample_ix,
    );
    let frame_end_sample_ix = if reverse {
      frame_start_sample_ix - played_samples_per_frame
    } else {
      frame_start_sample_ix + played_samples_per_frame
    };

    // how much the grain phase will be incremented by this frame
    let frame_length_phase = 1. / grain_len_frames;
    let (old_phase, new_phase) = (self.phase, self.phase + frame_length_phase);

    let mut frame_phase = 0.;
    for sample_ix_in_frame in 0..FRAME_SIZE {
      let sample_ix_in_sample_data =
        dsp::mix(frame_phase, frame_end_sample_ix, frame_start_sample_ix);
      if sample_ix_in_sample_data < 0. || sample_ix_in_sample_data >= (sample_data.len() - 1) as f32
      {
        break;
      }

      let grain_phase = dsp::mix(frame_phase, old_phase, new_phase);

      let base_sample = dsp::read_interpolated(sample_data, sample_ix_in_sample_data);
      let crossfade_amp_factor = crossfade.get_amp_factor(grain_phase, grain_len_samples);
      output[sample_ix_in_frame] += base_sample * crossfade_amp_factor;

      frame_phase += 1. / (FRAME_SIZE - 1) as f32;
    }

    self.phase = new_phase;
    new_phase >= 1.
  }
}

#[inline(always)]
fn uninit<T>() -> T { unsafe { std::mem::MaybeUninit::uninit().assume_init() } }

pub struct SamplerCtx {
  pub sample_data: Vec<f32>,
  pub active_grains: Vec<Grain>,
  pub output_buf: [f32; FRAME_SIZE],
  pub selections_by_midi_number: Box<[Option<GrainConfig>; 512]>,
}

impl Default for SamplerCtx {
  fn default() -> Self {
    let mut selections_by_midi_number: Box<[Option<GrainConfig>; 512]> = Box::new(uninit());
    for i in 0..selections_by_midi_number.len() {
      unsafe {
        std::ptr::write(&mut selections_by_midi_number[i], None);
      }
    }

    Self {
      sample_data: Vec::new(),
      active_grains: Vec::new(),
      output_buf: uninit(),
      selections_by_midi_number,
    }
  }
}

#[no_mangle]
pub extern "C" fn init_sampler_ctx() -> *mut SamplerCtx {
  let ctx = SamplerCtx::default();
  Box::into_raw(Box::new(ctx))
}

/// Resizes the sample data buffer and returns a pointer to the first element.
#[no_mangle]
pub extern "C" fn sampler_get_sample_data_ptr(ctx: *mut SamplerCtx, new_len: usize) -> *mut f32 {
  let ctx = unsafe { &mut *ctx };
  ctx.sample_data.resize(new_len, 0.);
  ctx.sample_data.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn sampler_process(ctx: *mut SamplerCtx) {
  let ctx = unsafe { &mut *ctx };
  ctx.output_buf.fill(0.);

  if ctx.sample_data.is_empty() {
    return;
  }

  for grain in &mut ctx.active_grains {
    grain.process(&ctx.sample_data, &mut ctx.output_buf);
  }
}

#[no_mangle]
pub extern "C" fn sampler_get_output_buf_ptr(ctx: *mut SamplerCtx) -> *mut f32 {
  let ctx = unsafe { &mut *ctx };
  ctx.output_buf.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn sampler_set_selection(
  ctx: *mut SamplerCtx,
  midi_number: usize,
  start_sample_ix: f32,
  end_sample_ix: f32,
  crossfade_start_len_samples: f32,
  crossfade_end_len_samples: f32,
  playback_rate: f32,
  reverse: bool,
) -> usize {
  let ctx = unsafe { &mut *ctx };

  if start_sample_ix >= end_sample_ix {
    panic!("start_sample_ix must be less than end_sample_ix");
  }

  let config: GrainConfig = GrainConfig {
    start_sample_ix,
    end_sample_ix,
    crossfade: CrossfadeConfig {
      start_len_samples: crossfade_start_len_samples,
      end_len_samples: crossfade_end_len_samples,
    },
    playback_rate,
    reverse,
  };
  ctx.selections_by_midi_number[midi_number] = Some(config);
  midi_number
}

#[no_mangle]
pub extern "C" fn sampler_clear_selection(ctx: *mut SamplerCtx, selection_ix: usize) {
  let ctx = unsafe { &mut *ctx };
  ctx.selections_by_midi_number[selection_ix] = None;
}

#[no_mangle]
pub extern "C" fn sampler_handle_midi_attack(ctx: *mut SamplerCtx, midi_number: usize) {
  let ctx = unsafe { &mut *ctx };
  let grain_config = ctx.selections_by_midi_number[midi_number].clone();
  if let Some(grain_config) = grain_config {
    let grain = Grain {
      config: grain_config,
      phase: 0.,
    };
    ctx.active_grains.push(grain);
  }
}
