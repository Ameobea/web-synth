/// https://ccrma.stanford.edu/~jos/fp/DC_Blocker.html

#[derive(Clone, Default)]
pub struct DCBlocker {
  last_sample: f32,
}

impl DCBlocker {
  pub fn apply(&mut self, sample: f32) -> f32 {
    sample - self.last_sample + 0.995 * self.last_sample
  }
}
