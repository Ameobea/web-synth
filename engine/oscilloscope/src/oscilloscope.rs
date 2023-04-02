use crate::{
  conf::{PAST_WINDOW_COUNT, SAMPLE_RATE},
  f0_estimation::YinCtx,
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
  Samples(usize),
  Wavelengths(f32),
}

impl WindowLength {
  pub(crate) fn from_parts(window_mode: u8, window_length: f32) -> Self {
    match window_mode {
      0 => WindowLength::Beats(window_length),
      1 => WindowLength::Seconds(window_length),
      2 => {
        if window_length < 0.0 {
          panic!("Invalid window length: {window_length}");
        }
        let window_length = window_length.trunc();
        WindowLength::Samples(window_length as usize)
      },
      3 => WindowLength::Wavelengths(window_length),
      _ => panic!("Invalid window mode: {window_mode}"),
    }
  }
}

#[derive(Clone)]
pub struct VizView {
  /// device pixel ratio
  pub dpr: usize,
  pub width: usize,
  pub height: usize,
}

#[derive(Default)]
pub(crate) struct PreviousWindow {
  pub image_data: Vec<u8>,
  pub samples: Vec<f32>,
}

impl PreviousWindow {
  pub const fn new() -> Self {
    PreviousWindow {
      image_data: Vec::new(),
      samples: Vec::new(),
    }
  }
}

pub(crate) struct Viz {
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
  /// If `true`, the viz will complete the current window and then keep displaying it until frozen
  /// becomes `false`
  ///
  /// This is the flag set by the user; a separate flag `frozen_window_complete` is used to
  /// determine if our current window is complete.
  pub frozen: bool,
  pub frozen_window_complete: bool,
  /// If `true`, the viz will continue updating the window as new samples are received.  If
  /// `false`, the viz will only update the window a complete next window is ready.
  pub frame_by_frame: bool,
  /// Previous rendered image data, with [0] being the most recent
  pub previous_windows: [PreviousWindow; PAST_WINDOW_COUNT],
  pub yin_ctx: YinCtx,
}

impl Viz {
  fn get_image_data_buffer_size_bytes(view: &VizView) -> usize {
    view.width * view.dpr * view.height * view.dpr * BYTES_PER_PX
  }

  pub fn set_view(&mut self, cur_bpm: f32, view: VizView) {
    let image_data_len_bytes = Self::get_image_data_buffer_size_bytes(&view);
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

    // previous windows are no longer valid
    self.clear_previous_windows();
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

  pub fn commit_samples(&mut self, samples: &[f32; FRAME_SIZE]) {
    if self.frozen && self.frozen_window_complete {
      return;
    }

    self.samples.extend_from_slice(samples);
    if matches!(self.window_length, WindowLength::Wavelengths(_)) {
      self.yin_ctx.process_frame(samples);
    }
  }

  fn get_view_length_samples(&self, cur_bpm: f32) -> f32 {
    match self.window_length {
      WindowLength::Beats(beats) => beats * 60.0 * SAMPLE_RATE / cur_bpm,
      WindowLength::Seconds(secs) => secs * SAMPLE_RATE,
      WindowLength::Samples(samples) => samples as f32,
      WindowLength::Wavelengths(multiplier) => {
        let f0 = self.yin_ctx.cur_f0_estimate;
        let f0 = if f0 > 0.0 { f0 } else { 1.0 };
        let period_samples = SAMPLE_RATE / f0;
        period_samples * multiplier
      },
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

    let steps = ((len * 1.5).floor() as usize).max(2);
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
    let color = (180, 0, 180, 255);
    Self::write_line_bilinear(pixels, &self.view, last_x_px, last_y_px, x_px, y_px, color);
  }

  fn render(
    &mut self,
    cur_bpm: f32,
    start_sample_ix_inclusive: usize,
    end_sample_ix_exclusive: usize,
  ) {
    for sample_ix in start_sample_ix_inclusive..end_sample_ix_exclusive {
      self.render_one_sample(cur_bpm, sample_ix);
    }

    self.last_processed_sample_ix = end_sample_ix_exclusive;
  }

  /// We clear the viz and start drawing from the start again
  fn maybe_clear_window(&mut self, cur_bpm: f32, cur_beat: f32, cur_time: f32) {
    let overrun_samples = match self.window_length {
      WindowLength::Beats(beats) => {
        let cur_beats = cur_beat % beats;
        if cur_beats < self.last_rendered_beat % beats {
          let phase = cur_beats / beats;
          let samples_per_beat = self.get_view_length_samples(cur_bpm) as f32 / beats;
          let samples = (samples_per_beat * beats * phase) as usize;
          Some(samples)
        } else {
          None
        }
      },
      WindowLength::Seconds(secs) => {
        let cur_secs = cur_time % secs;
        if cur_secs < self.last_rendered_time % secs {
          let phase = cur_secs / secs;
          let samples_per_sec = self.get_view_length_samples(cur_bpm) as f32 / secs;
          let samples = (samples_per_sec * secs * phase) as usize;
          Some(samples)
        } else {
          None
        }
      },
      WindowLength::Samples(samples) =>
        if self.samples.len() >= samples {
          Some(self.samples.len() % samples)
        } else {
          None
        },
      WindowLength::Wavelengths(_) => {
        let window_len = self.get_view_length_samples(cur_bpm);

        if self.samples.len() >= window_len as usize {
          Some(self.samples.len() % window_len as usize)
        } else {
          None
        }
      },
    };

    let needs_clear = overrun_samples.is_some();
    if !needs_clear {
      return;
    }
    let overrun_samples = overrun_samples.unwrap();

    if self.frozen {
      self.frozen_window_complete = true;
      return;
    }

    self.yin_ctx.cur_f0_estimate = self.yin_ctx.rolling_f0_estimate;

    // Swap our current image data buffer and samples into previous windows and replace with the
    // oldest one there to avoid allocations
    //
    // We shift the previous windows to the right and take the oldest one
    let oldest_window = std::mem::take(&mut self.previous_windows[self.previous_windows.len() - 1]);
    for i in (1..self.previous_windows.len()).rev() {
      self.previous_windows[i] = std::mem::take(&mut self.previous_windows[i - 1]);
    }

    let new_prev_window = PreviousWindow {
      image_data: std::mem::replace(&mut self.image_data, oldest_window.image_data),
      samples: std::mem::replace(&mut self.samples, oldest_window.samples),
    };

    // Resize new image data buffer for current view
    let image_data_len_bytes = Self::get_image_data_buffer_size_bytes(&self.view);
    self.image_data.resize(image_data_len_bytes, 0);

    self.clear_image_data_buffer();

    let mut old_samples: [f32; FRAME_SIZE * 8] =
      unsafe { std::mem::MaybeUninit::uninit().assume_init() };
    let old_samples_len = match self.window_length {
      WindowLength::Wavelengths(_) => {
        // We want to be as precise as possible with the window length, so we take the last
        // `overrun_samples` samples from the previous window and concat to the front of the
        // current window

        if overrun_samples > FRAME_SIZE * 8 {
          crate::log(&format!(
            "overrun_samples {} > FRAME_SIZE*4; window_len={}",
            overrun_samples,
            self.get_view_length_samples(cur_bpm)
          ));
        }
        overrun_samples.min(FRAME_SIZE * 8)
      },
      _ => {
        // Retain the last `FRAME_SIZE` samples from the previous window and concat to the front so
        // we don't miss any transients or anything

        new_prev_window.samples.len().min(FRAME_SIZE)
      },
    };

    self.last_processed_sample_ix = 0;
    old_samples[..old_samples_len]
      .copy_from_slice(&new_prev_window.samples[new_prev_window.samples.len() - old_samples_len..]);
    self.samples.clear();
    self
      .samples
      .extend_from_slice(&old_samples[..old_samples_len]);

    self.previous_windows[0] = new_prev_window;
  }

  pub fn process(&mut self, cur_bpm: f32, cur_beat: f32, cur_time: f32) {
    if self.last_processed_sample_ix == self.samples.len() {
      return;
    }

    if matches!(self.window_length, WindowLength::Wavelengths(_)) {
      let f0 = self.yin_ctx.rolling_f0_estimate;
      if f0 > SAMPLE_RATE / 2.0 {
        return;
      }
    }

    self.maybe_clear_window(cur_bpm, cur_beat, cur_time);

    if self.frozen && self.frozen_window_complete {
      return;
    }

    self.render(cur_bpm, self.last_processed_sample_ix, self.samples.len());

    self.last_rendered_beat = cur_beat;
    self.last_rendered_time = cur_time;
  }

  pub(crate) fn set_window(&mut self, window: WindowLength) {
    self.window_length = window;
    if !self.frozen_window_complete {
      self.last_processed_sample_ix = 0;
      self.clear_image_data_buffer();
    }

    // previous windows are no longer valid
    self.clear_previous_windows();
  }

  fn clear_previous_windows(&mut self) {
    for window in self.previous_windows.iter_mut() {
      *window = PreviousWindow::default();
    }
  }

  pub(crate) fn set_frozen(&mut self, frozen: bool) {
    if !frozen && self.frozen && self.frozen_window_complete {
      self.clear_image_data_buffer();
      self.last_processed_sample_ix = 0;
    }

    self.frozen = frozen;
    self.frozen_window_complete = false;
  }

  pub(crate) fn get_image_data(&self) -> &[u8] {
    if self.frame_by_frame {
      return &self.image_data;
    }

    return &self.previous_windows[0].image_data;
  }

  pub(crate) fn set_frame_by_frame(&mut self, frame_by_frame: bool) {
    self.frame_by_frame = frame_by_frame;
  }
}
