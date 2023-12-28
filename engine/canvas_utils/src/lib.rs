#[derive(Clone, Debug, PartialEq)]
pub struct VizView {
  /// device pixel ratio
  pub dpr: usize,
  pub width: usize,
  pub height: usize,
}

const BYTES_PER_PX: usize = 4;

impl VizView {
  /// Assumes RGBA format
  #[inline]
  pub fn get_image_data_buffer_size_bytes(&self) -> usize {
    self.width * self.dpr * self.height * self.dpr * BYTES_PER_PX
  }
}

#[inline]
pub fn write_pixel(
  pixels: &mut [(u8, u8, u8, u8)],
  view: &VizView,
  x_px: usize,
  y_px: usize,
  val: (u8, u8, u8, u8),
) {
  let px_ix = y_px * view.dpr * view.width * view.dpr + x_px * view.dpr;
  if px_ix >= pixels.len() {
    panic!(
      "write_pixel: px_ix: {}, pixels.len(): {}; x_px: {}, y_px: {}; view: {:?}",
      px_ix,
      pixels.len(),
      x_px,
      y_px,
      view,
    );
  }

  let target = unsafe { pixels.get_unchecked_mut(px_ix) };
  target.0 = target.0.saturating_add(val.0);
  target.1 = target.1.saturating_add(val.1);
  target.2 = target.2.saturating_add(val.2);
}

/// Writes a pixel to the image data buffer, using bilinear interpolation to handle fractional
/// pixel coordinates
#[inline]
pub fn write_pixel_bilinear(
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

  let is_x2_out_of_bounds = x2 >= view.width;
  let is_y2_out_of_bounds = y2 >= view.height;

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

  write_pixel(pixels, view, x1, y1, val11);
  if !is_x2_out_of_bounds {
    write_pixel(pixels, view, x2, y1, val12);
  }
  if !is_y2_out_of_bounds {
    write_pixel(pixels, view, x1, y2, val21);
  }
  if !is_x2_out_of_bounds && !is_y2_out_of_bounds {
    write_pixel(pixels, view, x2, y2, val22);
  }
}

#[inline]
pub fn write_line_bilinear(
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

  let steps = ((len * 1.5).floor() as usize).max(2);
  let step_size = 1.0 / steps as f32;

  fn mix(a: f32, b: f32, t: f32) -> f32 { a * (1.0 - t) + b * t }

  for i in 0..steps {
    let weight = i as f32 * step_size;
    let x = mix(x0_px, x1_px, weight);
    let y = mix(y0_px, y1_px, weight);
    write_pixel_bilinear(pixels, view, x, y, color);
  }
}
