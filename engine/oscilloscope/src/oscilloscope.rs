use crate::{
  conf::{SAMPLE_RATE, UPSAMPLE_FACTOR},
  FRAME_SIZE,
};

const BYTES_PER_PX: usize = 4;

fn clamp(min: f32, max: f32, val: f32) -> f32 {
  if val < min {
    min
  } else if val > max {
    max
  } else {
    val
  }
}

pub enum WindowLength {
  Beats(f32),
  Seconds(f32),
}

#[derive(Clone)]
pub struct VizView {
  /// device pixel ratio
  pub dpr: usize,
  pub width: usize,
  pub height: usize,
}

pub struct Viz {
  /// Stores all received samples for the currently rendered view
  pub samples: Vec<f32>,
  /// The user-configured length of the window
  pub window_length: WindowLength,
  pub last_processed_sample_ix: usize,
  pub last_rendered_beat: f32,
  pub last_rendered_time: f32,
  pub view: VizView,
  /// RGBA image data
  pub image_data: Vec<u8>,
}

impl Viz {
  pub fn set_view(&mut self, cur_bpm: f32, view: VizView) {
    let image_data_len_bytes =
      view.width * view.dpr * view.height * view.dpr * UPSAMPLE_FACTOR * BYTES_PER_PX;
    crate::log(&format!(
      "Allocating {image_data_len_bytes} bytes for image_data for view"
    ));
    self.image_data = Vec::with_capacity(image_data_len_bytes);
    unsafe {
      self.image_data.set_len(image_data_len_bytes);
    }
    self.clear_image_data_buffer();
    self.view = view;
    self.render(cur_bpm, 0, self.samples.len());
  }

  fn clear_image_data_buffer(&mut self) {
    let pixels: &mut [(u8, u8, u8, u8)] = unsafe {
      std::slice::from_raw_parts_mut(
        self.image_data.as_mut_ptr() as *mut _,
        self.image_data.len() / 4,
      )
    };
    for i in 0..pixels.len() {
      pixels[i] = (0, 0, 0, 255);
    }
  }

  pub fn commit_samples(&mut self, samples: &[f32]) { self.samples.extend_from_slice(samples); }

  fn get_view_length_samples(&self, cur_bpm: f32) -> f32 {
    match self.window_length {
      WindowLength::Beats(beats) => beats * 60.0 * SAMPLE_RATE / cur_bpm,
      WindowLength::Seconds(secs) => secs * SAMPLE_RATE,
    }
  }

  fn render_one_sample(&mut self, cur_bpm: f32, sample_ix: usize) {
    let sample = self.samples[sample_ix];

    // TODO: This is a placeholder impl
    let min_y = -1.0f32;
    let max_y = 1.0f32;
    let phase = sample_ix as f32 / self.get_view_length_samples(cur_bpm);
    let phase = clamp(0., 1., phase);
    let x = phase * self.view.width as f32;
    let y = (sample - min_y) / (max_y - min_y) * self.view.height as f32;
    // clamp y to [0, height]
    // TODO: support dynamic min/max
    let y = clamp(0., (self.view.height - 1) as f32, y);
    let y = self.view.height as f32 - y;

    let x_px = x as usize * self.view.dpr;
    let y_px = y as usize * self.view.dpr;

    let pixels: &mut [(u8, u8, u8, u8)] = unsafe {
      std::slice::from_raw_parts_mut(
        self.image_data.as_mut_ptr() as *mut _,
        self.image_data.len() / 4,
      )
    };
    let row_length_px = self.view.width * UPSAMPLE_FACTOR;
    let px_ix = y_px * row_length_px + x_px;
    if px_ix >= self.image_data.len() {
      crate::log(&format!(
        "render_one_sample: px_ix: {}, image_data.len(): {}; x: {}, y: {}, x_px: {}, y_px: {}",
        px_ix,
        self.image_data.len(),
        x,
        y,
        x_px,
        y_px,
      ));
    }
    pixels[px_ix] = (255, 0, 255, 255);
  }

  fn render(
    &mut self,
    cur_bpm: f32,
    start_sample_ix_inclusive: usize,
    end_sample_ix_exclusive: usize,
  ) {
    // crate::log(&format!(
    //   "render: start_sample_ix_inclusive: {}, end_sample_ix_exclusive: {}",
    //   start_sample_ix_inclusive, end_sample_ix_exclusive
    // ));
    for sample_ix in start_sample_ix_inclusive..end_sample_ix_exclusive {
      self.render_one_sample(cur_bpm, sample_ix);
    }

    self.last_processed_sample_ix = end_sample_ix_exclusive;
  }

  /// We clear the viz and start drawing from the start again
  fn maybe_clear_window(&mut self, cur_beat: f32, cur_time: f32) {
    let needs_clear = match self.window_length {
      WindowLength::Beats(beats) => (cur_beat % beats) < self.last_rendered_beat % beats,
      WindowLength::Seconds(secs) => (cur_time % secs) < self.last_rendered_time % secs,
    };
    if !needs_clear {
      return;
    }
    crate::log("Clearing viz window");

    self.clear_image_data_buffer();
    // Retain the last `FRAME_SIZE` samples from the previous window and concat to the front so we
    // don't miss any transients or anything
    // let mut old_samples: [f32; FRAME_SIZE] = [0.0; FRAME_SIZE];
    // let old_samples_len = self.samples.len().min(FRAME_SIZE);
    // old_samples[..old_samples_len]
    //   .copy_from_slice(&self.samples[self.samples.len() - old_samples_len..]);
    self.samples.clear();
    // self
    //   .samples
    //   .extend_from_slice(&old_samples[..old_samples_len]);
    self.last_processed_sample_ix = 0;
  }

  pub fn process(&mut self, cur_bpm: f32, cur_beat: f32, cur_time: f32) {
    if self.last_processed_sample_ix == self.samples.len() {
      return;
    }

    self.maybe_clear_window(cur_beat, cur_time);

    self.render(cur_bpm, self.last_processed_sample_ix, self.samples.len());

    self.last_rendered_beat = cur_beat;
    self.last_rendered_time = cur_time;
  }
}
