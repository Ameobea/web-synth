use canvas_utils::{write_pixel_bilinear, VizView};
use ndarray::ArrayView1;

use super::{
  conf::{CLEAR_COLOR, FFT_BUFFER_SIZE, LINE_COLOR},
  cubic_spline::draw_cubic_spline,
};

pub(super) struct LineSpectrumCtx {
  pub view: VizView,
  pub frequency_data_buf: [u8; FFT_BUFFER_SIZE],
  pub frequency_data_buf_f32: [f32; FFT_BUFFER_SIZE],
  /// RGBA format
  pub image_data_buf: Vec<u8>,
}

impl LineSpectrumCtx {
  fn clear_image_data_buf(&mut self) {
    let pixels: &mut [(u8, u8, u8, u8)] = unsafe {
      std::slice::from_raw_parts_mut(
        self.image_data_buf.as_mut_ptr() as *mut _,
        self.image_data_buf.len() / 4,
      )
    };
    for pixel in pixels {
      *pixel = CLEAR_COLOR;
    }
  }

  pub(crate) fn set_view(&mut self, new_view: VizView) {
    if self.view == new_view {
      return;
    }

    self.view = new_view;
    let needed_buf_size = self.view.get_image_data_buffer_size_bytes();
    if self.image_data_buf.len() != needed_buf_size {
      self.image_data_buf.resize(needed_buf_size, 0);
    }
    self.clear_image_data_buf();
  }

  pub fn process(&mut self) {
    if self.view.width == 0 || self.view.height == 0 {
      return;
    }

    // Convert our u8 frequency data to f32 and pre-scale to canvas height
    for (i, &byte) in self.frequency_data_buf.iter().enumerate() {
      self.frequency_data_buf_f32[i] = (byte as f32 / 255.0) * (self.view.height - 1) as f32;
    }

    self.clear_image_data_buf();

    let pixels: &mut [(u8, u8, u8, u8)] = unsafe {
      std::slice::from_raw_parts_mut(
        self.image_data_buf.as_mut_ptr() as *mut _,
        self.image_data_buf.len() / 4,
      )
    };
    let draw_point = |x: f32, y: f32| write_pixel_bilinear(pixels, &self.view, x, y, LINE_COLOR);

    let ys: ArrayView1<f32> = ArrayView1::from(&self.frequency_data_buf_f32);

    let points_per_pixel = 2.5;
    draw_cubic_spline(
      self.view.width as u32,
      self.view.height as u32,
      &ys,
      points_per_pixel,
      draw_point,
    );
  }
}
