use compressor::MultibandCompressor;

use crate::fm::FRAME_SIZE;

use super::Effect;

#[derive(Clone)]
pub struct CompressorEffect {
  pub inner: MultibandCompressor,
  // We add a `FRAME_SIZE` delay in order to allow the compressor to be applied to a whole frame
  // at a time.
  pub prev_frame: [f32; FRAME_SIZE],
  pub cur_frame_ix: usize,
}

impl Effect for CompressorEffect {
  fn get_params<'a>(&'a mut self, buf: &mut [Option<&'a mut crate::fm::ParamSource>; 4]) {
    // TODO
    for i in 0..buf.len() {
      buf[i] = None;
    }
  }

  fn apply(&mut self, _rendered_params: &[f32], _base_frequency: f32, sample: f32) -> f32 {
    self.inner.input_buffer[self.cur_frame_ix] = sample;
    let output = self.inner.output_buffer[self.cur_frame_ix];
    self.cur_frame_ix += 1;

    if self.cur_frame_ix == FRAME_SIZE {
      self.cur_frame_ix = 0;
      self.inner.apply(
        1., 1., 1., 1., 1., 1., 3., 250., 3., 250., 3., 250., -34., -34., -34., -24., -24., -24.,
        1., 1., 1., 12., 12., 12., 30., 256, 1., 1., 1.,
      );
    }

    output
  }
}
