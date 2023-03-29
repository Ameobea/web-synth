/// We render the waveform displayed in the oscilloscope at a higher resolution and then downscale
/// it to the actual canvas size.
pub(crate) const UPSAMPLE_FACTOR: usize = 1; // TODO
pub(crate) const SAMPLE_RATE: f32 = 44_100.0;
