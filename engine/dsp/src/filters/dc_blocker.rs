/// https://ccrma.stanford.edu/~jos/fp/DC_Blocker.html

#[derive(Clone, Default)]
pub struct DCBlocker {
  last_input: f32,
  last_output: f32,
}

impl DCBlocker {
  pub fn apply(&mut self, sample: f32) -> f32 {
    let out = sample - self.last_input + 0.9975 * self.last_output;
    self.last_input = sample;
    self.last_output = out;
    out
  }
}
