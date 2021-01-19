use dsp::filters::butterworth::ButterworthFilter as InnerButterworthFilter;

use crate::fm::ParamSource;

use super::Effect;

#[derive(Clone, Copy)]
pub enum ButterworthFilterMode {
    Lowpass,
    Highpass,
    Bandpass,
}

impl From<usize> for ButterworthFilterMode {
    fn from(val: usize) -> Self {
        match val {
            0 => ButterworthFilterMode::Lowpass,
            1 => ButterworthFilterMode::Highpass,
            2 => ButterworthFilterMode::Bandpass,
            _ => panic!("Invalid butterworth filter mode: {}", val),
        }
    }
}

#[derive(Clone)]
pub struct ButterworthFilter {
    inner: InnerButterworthFilter,
    pub mode: ButterworthFilterMode,
    pub cutoff_freq: ParamSource,
}

impl ButterworthFilter {
    pub fn new(mode: ButterworthFilterMode, cutoff_freq: ParamSource) -> Self {
        ButterworthFilter {
            inner: InnerButterworthFilter::default(),
            mode,
            cutoff_freq,
        }
    }
}

impl Effect for ButterworthFilter {
    fn apply(
        &mut self,
        param_buffers: &[[f32; crate::fm::FRAME_SIZE]],
        adsrs: &[adsr::Adsr],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample: f32,
    ) -> f32 {
        let cutoff_freq =
            self.cutoff_freq
                .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);
        match self.mode {
            ButterworthFilterMode::Lowpass => self.inner.lowpass(cutoff_freq, sample),
            ButterworthFilterMode::Highpass => self.inner.highpass(cutoff_freq, sample),
            ButterworthFilterMode::Bandpass => self.inner.bandpass(cutoff_freq, sample),
        }
    }
}
