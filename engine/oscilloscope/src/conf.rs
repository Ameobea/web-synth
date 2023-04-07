use crate::FRAME_SIZE;

pub(crate) const SAMPLE_RATE: f32 = 44_100.0;
pub(crate) const PAST_WINDOW_COUNT: usize = 8;

pub(crate) const YIN_FRAME_SIZE: usize = FRAME_SIZE * 32;
// 40Hz as samples
pub(crate) const YIN_MAX_PERIOD: usize = SAMPLE_RATE as usize / 40;
pub(crate) const YIN_THRESHOLD: f32 = 0.05;

pub(crate) const PEAK_LEVEL_PAST_WINDOW_LOOKBACK_COUNT: usize = 8;
