use super::Effect;
use crate::fm::{ADSRState, ParamSource, FRAME_SIZE};

#[derive(Clone)]
pub struct Bitcrusher {
    pub sample_rate: ParamSource,
    pub bit_depth: ParamSource,
}

impl Effect for Bitcrusher {
    fn apply(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample: f32,
    ) -> f32 {
        todo!()
    }
}
