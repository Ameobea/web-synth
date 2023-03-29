use crate::{conf::SAMPLE_RATE, FRAME_SIZE};

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
    let image_data_len_bytes = view.width * view.dpr * view.height * view.dpr * BYTES_PER_PX;
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

  fn compute_sample_coords(&self, cur_bpm: f32, sample_ix: usize, sample: f32) -> (f32, f32) {
    let min_y = -1.0f32;
    let max_y = 1.0f32;

    let phase = sample_ix as f32 / self.get_view_length_samples(cur_bpm);
    let phase = clamp(0., 1., phase);
    let x = phase * self.view.width as f32;
    let y = (sample - min_y) / (max_y - min_y) * self.view.height as f32;
    // clamp y to [0, height]
    let y = clamp(0., (self.view.height - 1) as f32, y);
    // y is flipped
    let y = (self.view.height - 1) as f32 - y;

    let x_px = clamp(
      0.,
      self.view.width as f32 * self.view.dpr as f32 - 1.,
      x * self.view.dpr as f32,
    );
    let y_px = clamp(
      0.,
      self.view.height as f32 * self.view.dpr as f32 - 1.,
      y * self.view.dpr as f32,
    );

    (x_px, y_px)
  }

  fn write_pixel(
    pixels: &mut [(u8, u8, u8, u8)],
    view: &VizView,
    x_px: usize,
    y_px: usize,
    val: (u8, u8, u8, u8),
  ) {
    let px_ix = y_px as usize * view.width + x_px as usize;
    if px_ix >= pixels.len() {
      crate::log(&format!(
        "write_pixel_bilinearly: px_ix: {}, pixels.len(): {}; x_px: {}, y_px: {}",
        px_ix,
        pixels.len(),
        x_px,
        y_px,
      ));
      return;
    }
    let mut target = &mut pixels[px_ix];
    target.0 = target.0.saturating_add(val.0);
    target.1 = target.1.saturating_add(val.1);
    target.2 = target.2.saturating_add(val.2);
  }

  /// Writes a pixel to the image data buffer, using bilinear interpolation to handle fractional
  /// pixel coordinates
  fn write_pixel_bilinear(
    pixels: &mut [(u8, u8, u8, u8)],
    view: &VizView,
    x_px: f32,
    y_px: f32,
    color: (u8, u8, u8, u8),
  ) {
    let x1 = x_px.floor() as usize;
    let y1 = y_px.floor() as usize;
    let x2 = x1 + 1;
    let y2 = y1 + 1;

    let x_frac = x_px - x1 as f32;
    let y_frac = y_px - y1 as f32;

    let row_length_px = view.width;

    let is_x2_out_of_bounds = x2 >= row_length_px;
    let is_y2_out_of_bounds = y2 >= pixels.len() / row_length_px;

    let w11 = (1.0 - x_frac) * (1.0 - y_frac);
    let w12 = x_frac * (1.0 - y_frac);
    let w21 = (1.0 - x_frac) * y_frac;
    let w22 = x_frac * y_frac;

    let val11 = (
      (color.0 as f32 * w11) as u8,
      (color.1 as f32 * w11) as u8,
      (color.2 as f32 * w11) as u8,
      (color.3 as f32 * w11) as u8,
    );
    let val12 = (
      (color.0 as f32 * w12) as u8,
      (color.1 as f32 * w12) as u8,
      (color.2 as f32 * w12) as u8,
      (color.3 as f32 * w12) as u8,
    );
    let val21 = (
      (color.0 as f32 * w21) as u8,
      (color.1 as f32 * w21) as u8,
      (color.2 as f32 * w21) as u8,
      (color.3 as f32 * w21) as u8,
    );
    let val22 = (
      (color.0 as f32 * w22) as u8,
      (color.1 as f32 * w22) as u8,
      (color.2 as f32 * w22) as u8,
      (color.3 as f32 * w22) as u8,
    );

    Self::write_pixel(pixels, view, x1, y1, val11);
    if !is_x2_out_of_bounds {
      Self::write_pixel(pixels, view, x2, y1, val12);
    }
    if !is_y2_out_of_bounds {
      Self::write_pixel(pixels, view, x1, y2, val21);
    }
    if !is_x2_out_of_bounds && !is_y2_out_of_bounds {
      Self::write_pixel(pixels, view, x2, y2, val22);
    }
  }

  fn write_line_bilinear(
    pixels: &mut [(u8, u8, u8, u8)],
    view: &VizView,
    x0_px: f32,
    y0_px: f32,
    x1_px: f32,
    y1_px: f32,
    color: (u8, u8, u8, u8),
  ) {
    fn distance(x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
      ((x1 - x0).powi(2) + (y1 - y0).powi(2)).sqrt()
    }

    let len = distance(x0_px, y0_px, x1_px, y1_px);
    if len > 100.0 {
      crate::log(&format!(
        "write_line_bilinear: len: {}, x0_px: {}, y0_px: {}, x1_px: {}, y1_px: {}",
        len, x0_px, y0_px, x1_px, y1_px
      ));
    }

    let steps = (len.floor() as usize).max(2);
    let step_size = 1.0 / steps as f32;

    fn mix(a: f32, b: f32, t: f32) -> f32 { a * (1.0 - t) + b * t }

    for i in 0..steps {
      let weight = i as f32 * step_size;
      let x = mix(x0_px, x1_px, weight);
      let y = mix(y0_px, y1_px, weight);
      Self::write_pixel_bilinear(pixels, view, x, y, color);
    }
  }

  fn render_one_sample(&mut self, cur_bpm: f32, sample_ix: usize) {
    let sample = self.samples[sample_ix];
    let last_sample = if sample_ix == 0 {
      sample
    } else {
      self.samples[sample_ix - 1]
    };

    let (mut last_x_px, mut last_y_px) =
      self.compute_sample_coords(cur_bpm, sample_ix - 1, last_sample);
    let (x_px, y_px) = self.compute_sample_coords(cur_bpm, sample_ix, sample);
    // Avoid drawing lines backwards if we've just looped around
    if last_x_px >= x_px {
      last_x_px = x_px;
      last_y_px = y_px;
    }

    let pixels: &mut [(u8, u8, u8, u8)] = unsafe {
      std::slice::from_raw_parts_mut(
        self.image_data.as_mut_ptr() as *mut _,
        self.image_data.len() / 4,
      )
    };
    let color = (200, 0, 200, 255);
    // Self::write_pixel_bilinear(pixels, &self.view, x_px, y_px, color);
    Self::write_line_bilinear(pixels, &self.view, last_x_px, last_y_px, x_px, y_px, color);
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

    self.clear_image_data_buffer();
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
