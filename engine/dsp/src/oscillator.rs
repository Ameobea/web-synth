const SAMPLE_RATE: usize = 44_100;

pub trait PhasedOscillator {
  fn get_phase(&self) -> f32;

  fn set_phase(&mut self, new_phase: f32);

  fn update_phase(&mut self, frequency: f32) {
    // 1 phase corresponds to 1 period of the waveform.  1 phase is passed every (SAMPLE_RATE /
    // frequency) samples.
    let phase = self.get_phase();
    // if frequency.is_normal() && frequency.abs() > 0.001 {
    let mut new_phase = (phase + (1. / (SAMPLE_RATE as f32 / frequency))).fract();
    if new_phase < 0. {
      new_phase = 1. + new_phase;
    }
    self.set_phase(new_phase);
    // }
  }

  fn update_phase_oversampled(&mut self, oversample_multiplier: f32, frequency: f32) {
    self.update_phase(frequency / oversample_multiplier)
  }
}
