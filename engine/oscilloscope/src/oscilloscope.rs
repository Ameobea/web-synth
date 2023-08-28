use canvas_utils::{write_line_bilinear, VizView};

use crate::{
  conf::{PAST_WINDOW_COUNT, PEAK_LEVEL_PAST_WINDOW_LOOKBACK_COUNT, SAMPLE_RATE},
  f0_estimation::YinCtx,
  FRAME_SIZE,
};

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

#[derive(Default)]
pub(crate) struct PreviousWindow {
  pub image_data: Vec<u8>,
  pub samples: Vec<f32>,
  pub abs_peak_level: f32,
}

impl PreviousWindow {
  pub const fn new() -> Self {
    PreviousWindow {
      image_data: Vec::new(),
      samples: Vec::new(),
      abs_peak_level: 0.,
    }
  }
}

unsafe fn uninit<T>() -> T { unsafe { std::mem::MaybeUninit::uninit().assume_init() } }

pub(crate) struct Viz {
  /// Stores all received samples for the currently rendered view
  pub samples: Vec<f32>,
  /// The user-configured length of the window
  pub window_length: WindowLength,
  /// Only used when window length is in wavelengths.  If true, the detected fundamental frequency
  /// will be snapped to the nearest MIDI note.
  pub snap_f0_to_midi: bool,
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
  /// This holds the locked y range for the current window which is computed using the detected RMS
  /// level. It is locked per frame to avoid distorting waveforms when the level changes during a
  /// window. Values outside of this range are clamped.
  pub cur_frame_y_range: (f32, f32),
  pub cur_window_peak_level: f32,
}

fn snap_freq_to_nearest_midi_note(freq_hz: f32) -> f32 {
  let midi_note = 12.0 * (freq_hz / 440.0).log2() + 69.0;
  let midi_note = midi_note.round();
  440.0 * 2.0f32.powf((midi_note - 69.0) / 12.0)
}

impl Viz {
  pub fn set_view(&mut self, cur_bpm: f32, view: VizView) {
    let image_data_len_bytes = view.get_image_data_buffer_size_bytes();
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

    if matches!(self.window_length, WindowLength::Wavelengths(_)) {
      self.yin_ctx.process_frame(samples);

      // wavelength multiplier window length depends on frequency detection, and if there is silence
      // than it's unable to do that.  So to avoid filling the buffer infinitely, we wait until
      // there is non-silence to start recording samples again
      let f0 = self.yin_ctx.rolling_f0_estimate;
      if f0 > SAMPLE_RATE / 2.0 {
        self.samples.clear();
        return;
      }
    }

    for &sample in samples {
      self.cur_window_peak_level = self.cur_window_peak_level.max(sample.abs());
    }

    self.samples.extend_from_slice(samples);
  }

  fn get_view_length_samples(&self, cur_bpm: f32) -> f32 {
    match self.window_length {
      WindowLength::Beats(beats) => beats * 60.0 * SAMPLE_RATE / cur_bpm,
      WindowLength::Seconds(secs) => secs * SAMPLE_RATE,
      WindowLength::Samples(samples) => samples as f32,
      WindowLength::Wavelengths(multiplier) => {
        let f0 = self.yin_ctx.cur_f0_estimate;
        let mut f0 = if f0 > 0.0 { f0 } else { 1.0 };
        if self.snap_f0_to_midi {
          f0 = snap_freq_to_nearest_midi_note(f0);
        }
        let period_samples = SAMPLE_RATE / f0;
        period_samples * multiplier
      },
    }
  }

  fn compute_y_range(&self) -> (f32, f32) {
    let mut peak = 0.;
    for past_window_ix in 0..PEAK_LEVEL_PAST_WINDOW_LOOKBACK_COUNT {
      peak = self.previous_windows[past_window_ix]
        .abs_peak_level
        .max(peak);
    }

    let scale = peak.max(1.);
    (-scale, scale)
  }

  fn compute_sample_coords(&self, cur_bpm: f32, sample_ix: usize, sample: f32) -> (f32, f32) {
    let (min_y, max_y) = self.cur_frame_y_range;

    let phase = sample_ix as f32 / self.get_view_length_samples(cur_bpm);
    let phase = clamp(0., 1., phase);
    let x = phase * self.view.width as f32;
    let y = (sample - min_y) / (max_y - min_y) * self.view.height as f32;
    // clamp y to [0, height]
    let y = clamp(0., (self.view.height - 1) as f32, y);
    // y is flipped
    let y = (self.view.height - 1) as f32 - y;

    let x_px = clamp(0., self.view.width as f32 - 1., x);
    let y_px = clamp(0., self.view.height as f32 - 1., y);

    (x_px, y_px)
  }

  fn render_one_sample(&mut self, cur_bpm: f32, sample_ix: usize) {
    let sample = self.samples[sample_ix];
    let (x_px, y_px) = self.compute_sample_coords(cur_bpm, sample_ix, sample);

    let (mut last_x_px, mut last_y_px) = if sample_ix == 0 {
      (x_px, y_px)
    } else {
      let last_sample = self.samples[sample_ix - 1];
      self.compute_sample_coords(cur_bpm, sample_ix - 1, last_sample)
    };

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
    write_line_bilinear(pixels, &self.view, last_x_px, last_y_px, x_px, y_px, color);
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
      abs_peak_level: self.cur_window_peak_level,
    };
    self.cur_window_peak_level = 0.;
    self.cur_frame_y_range = self.compute_y_range();

    // Resize new image data buffer for current view
    let image_data_len_bytes = self.view.get_image_data_buffer_size_bytes();
    self.image_data.resize(image_data_len_bytes, 0);

    self.clear_image_data_buffer();

    let mut old_samples: [f32; FRAME_SIZE * 8] = unsafe { uninit() };
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
