//! Support for using the FM synth effects as a standalone patch network node without the underlying
//! FM synth.

use adsr::Adsr;

use super::{effects::EffectChain, AdsrParams, RenderRawParams, FRAME_SIZE};

const FM_SYNTH_PARAM_BUFFER_COUNT: usize = 4;

pub struct FMSynthFxCtx {
  pub adsrs: Vec<Adsr>,
  pub adsr_params: Vec<AdsrParams>,
  pub param_buffers: [[f32; FRAME_SIZE]; FM_SYNTH_PARAM_BUFFER_COUNT],
  pub base_frequencies: [f32; FRAME_SIZE],
  pub effect_chain: EffectChain,
  pub io_buf: [f32; FRAME_SIZE],
}

impl FMSynthFxCtx {
  fn update_adsrs(&mut self) {
    for (adsr_ix, adsr) in self.adsrs.iter_mut().enumerate() {
      // Compute derived length for the ADSR for this frame and set it in.  We only support
      // k-rate ADSR length params for now; I don't think it will be a problem
      let len_samples = self.adsr_params[adsr_ix]
        .len_samples
        // Cannot use ADSR or base frequency as param sources for ADSR length
        .get(&self.param_buffers, &[], 0, 0.);
      adsr.set_len(len_samples, None);
      adsr.render_frame(1., 0., 0.);
    }
  }

  pub fn process(&mut self) {
    self.update_adsrs();

    let render_params = RenderRawParams {
      param_buffers: &self.param_buffers,
      adsrs: &self.adsrs,
      base_frequencies: &self.base_frequencies,
    };
    self.effect_chain.pre_render_params(&render_params);

    self
      .effect_chain
      .apply_all(&render_params, &mut self.io_buf);
  }
}

#[no_mangle]
pub extern "C" fn fm_synth_fx_create_ctx() -> *mut FMSynthFxCtx {
  let ctx = Box::new(FMSynthFxCtx {
    adsrs: Vec::new(),
    adsr_params: Vec::new(),
    param_buffers: [[0.0; FRAME_SIZE]; FM_SYNTH_PARAM_BUFFER_COUNT],
    base_frequencies: [0.0; FRAME_SIZE],
    effect_chain: EffectChain::default(),
    io_buf: [0.0; FRAME_SIZE],
  });
  Box::into_raw(ctx)
}

#[no_mangle]
pub extern "C" fn fm_synth_fx_set_effect(
  ctx: *mut FMSynthFxCtx,
  effect_ix: usize,
  effect_type: isize,
  param_1_type: usize,
  param_1_int_val: usize,
  param_1_float_val: f32,
  param_1_float_val_2: f32,
  param_1_float_val_3: f32,
  param_2_type: usize,
  param_2_int_val: usize,
  param_2_float_val: f32,
  param_2_float_val_2: f32,
  param_2_float_val_3: f32,
  param_3_type: usize,
  param_3_int_val: usize,
  param_3_float_val: f32,
  param_3_float_val_2: f32,
  param_3_float_val_3: f32,
  param_4_type: usize,
  param_4_int_val: usize,
  param_4_float_val: f32,
  param_4_float_val_2: f32,
  param_4_float_val_3: f32,
  is_bypassed: bool,
) {
  let ctx = unsafe { &mut *ctx };

  if effect_type == -1 {
    ctx.effect_chain.remove_effect(effect_ix);
    return;
  }

  ctx.effect_chain.set_effect(
    effect_ix,
    effect_type as usize,
    param_1_type,
    param_1_int_val,
    param_1_float_val,
    param_1_float_val_2,
    param_1_float_val_3,
    param_2_type,
    param_2_int_val,
    param_2_float_val,
    param_2_float_val_2,
    param_2_float_val_3,
    param_3_type,
    param_3_int_val,
    param_3_float_val,
    param_3_float_val_2,
    param_3_float_val_3,
    param_4_type,
    param_4_int_val,
    param_4_float_val,
    param_4_float_val_2,
    param_4_float_val_3,
    is_bypassed,
  );
}

#[no_mangle]
pub extern "C" fn fm_synth_fx_process(ctx: *mut FMSynthFxCtx) {
  let ctx = unsafe { &mut *ctx };
  ctx.process();
}

#[no_mangle]
pub extern "C" fn fm_synth_fx_get_io_buf_ptr(ctx: *mut FMSynthFxCtx) -> *mut f32 {
  let ctx = unsafe { &mut *ctx };
  ctx.io_buf.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn fm_synth_fx_get_params_buf_ptr(ctx: *mut FMSynthFxCtx) -> *mut f32 {
  let ctx = unsafe { &mut *ctx };
  ctx.param_buffers[0].as_mut_ptr()
}
