use crate::FRAME_SIZE;

pub enum WindowLength {
  Beats(f32),
  Seconds(f32),
}

pub struct Viz {
  /// Stores all received samples for the currently rendered view
  pub samples: Vec<f32>,
  /// The user-configured length of the window
  pub window_length: WindowLength,
  pub last_processed_sample_ix: usize,
  pub last_rendered_beat: f32,
  pub last_rendered_time: f32,
}

impl Viz {
  pub fn commit_samples(&mut self, samples: &[f32]) { self.samples.extend_from_slice(samples); }

  fn render(&mut self) {
    // TODO
  }

  /// We clear the viz and start drawing from the start again
  fn maybe_clear_window(&mut self, cur_beat: f32, cur_time: f32) {
    let needs_clear = match self.window_length {
      WindowLength::Beats(_) => cur_beat < self.last_rendered_beat,
      WindowLength::Seconds(_) => cur_time < self.last_rendered_time,
    };
    if !needs_clear {
      return;
    }

    // Retain the last `FRAME_SIZE` samples from the previous window and concat to the front so we
    // don't miss any transients or anything
    let mut old_samples: [f32; FRAME_SIZE] = [0.0; FRAME_SIZE];
    let old_samples_len = self.samples.len().min(FRAME_SIZE);
    old_samples[..old_samples_len]
      .copy_from_slice(&self.samples[self.samples.len() - old_samples_len..]);
    self.samples.clear();
    self
      .samples
      .extend_from_slice(&old_samples[..old_samples_len]);
  }

  pub fn process(&mut self, cur_bpm: f32, cur_beat: f32, cur_time: f32) {
    if self.last_processed_sample_ix == self.samples.len() {
      return;
    }

    self.maybe_clear_window(cur_beat, cur_time);

    self.render();

    self.last_rendered_beat = cur_beat;
    self.last_rendered_time = cur_time;
  }
}
