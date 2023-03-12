use crate::{exports::AdsrLengthMode, Adsr, SAMPLE_RATE};

fn ms_to_samples(ms: f32) -> f32 { (ms / 1000.) * SAMPLE_RATE as f32 }

#[derive(Clone)]
pub struct ManagedAdsr {
  pub adsr: Adsr,
  pub length_mode: AdsrLengthMode,
  pub length: f32,
}

impl ManagedAdsr {
  fn get_len_samples(&self, cur_bpm: f32) -> f32 {
    match self.length_mode {
      AdsrLengthMode::Ms => ms_to_samples(self.length),
      AdsrLengthMode::Beats => {
        let cur_bps = cur_bpm / 60.;
        let seconds_per_beat = 1. / cur_bps;
        let samples_per_beat = seconds_per_beat * SAMPLE_RATE as f32;
        samples_per_beat * self.length
      },
    }
  }

  pub fn set_length(&mut self, new_length_mode: AdsrLengthMode, new_length: f32) {
    self.length_mode = new_length_mode;
    self.length = new_length;
  }

  pub fn render(&mut self) { self.adsr.render(); }

  pub fn render_frame(&mut self, scale: f32, shift: f32, cur_bpm: f32, cur_frame_start_beat: f32) {
    let length_samples = self.get_len_samples(cur_bpm);
    let length_beats = match self.length_mode {
      AdsrLengthMode::Ms => None,
      AdsrLengthMode::Beats => Some(self.length),
    };
    self.adsr.set_len(length_samples, length_beats);
    self.adsr.render_frame(scale, shift, cur_frame_start_beat);
  }
}
