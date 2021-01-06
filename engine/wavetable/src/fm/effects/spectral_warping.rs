use adsr::Adsr;
use dsp::circular_buffer::CircularBuffer;

use super::Effect;
use crate::fm::{ExponentialOscillator, ParamSource, FRAME_SIZE, SAMPLE_RATE};

pub const SPECTRAL_WARPING_BUFFER_SIZE: usize = 44100 * 2;

pub struct SpectralWarpingParams {
    pub warp_factor: ParamSource,
    pub frequency: ParamSource,
    // TODO: Make this a param source if it turns out to have an effect on the sound
    pub phase_offset: f32,
}

#[derive(Clone)]
pub struct SpectralWarping {
    pub frequency: ParamSource,
    pub buffer: Box<CircularBuffer<SPECTRAL_WARPING_BUFFER_SIZE>>,
    pub phase_offset: f32,
    pub osc: ExponentialOscillator,
}

impl SpectralWarping {
    pub fn new(
        SpectralWarpingParams {
            warp_factor,
            frequency,
            phase_offset,
        }: SpectralWarpingParams,
    ) -> Self {
        SpectralWarping {
            frequency,
            buffer: box CircularBuffer::new(),
            phase_offset,
            osc: ExponentialOscillator::new(warp_factor),
        }
    }

    fn get_phase_warp_diff(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[Adsr],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        frequency: f32,
    ) -> f32 {
        let warped_phase = (self.osc.gen_sample(
            frequency,
            param_buffers,
            adsrs,
            sample_ix_within_frame,
            base_frequency,
        ) + 1.)
            / 2.;
        debug_assert!(warped_phase >= 0.);
        debug_assert!(warped_phase <= 1.);
        debug_assert!(self.osc.phase >= 0.);
        debug_assert!(self.osc.phase <= 1.);
        warped_phase - self.osc.phase
    }
}

impl Effect for SpectralWarping {
    fn apply(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[Adsr],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample: f32,
    ) -> f32 {
        self.buffer.set(sample);
        let frequency =
            self.frequency
                .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);
        // We look back half of the wavelength of the frequency.
        let base_lookback_samples = ((SAMPLE_RATE as f32) / frequency) / 2.;
        if !base_lookback_samples.is_normal() {
            return sample;
        }

        // We then "warp" the position of the read head according to the warp factor.
        let phase_warp_diff = self.get_phase_warp_diff(
            param_buffers,
            adsrs,
            sample_ix_within_frame,
            base_frequency,
            frequency,
        );
        debug_assert!(phase_warp_diff >= -1.);
        debug_assert!(phase_warp_diff <= 1.);
        let lookback_samples = base_lookback_samples + (base_lookback_samples * phase_warp_diff);
        debug_assert!(lookback_samples >= 0.);

        self.buffer.read_interpolated(-lookback_samples)
    }
}
