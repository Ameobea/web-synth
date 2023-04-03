use ndarray::prelude::*;

/// Computes the coefficients for a cubic spline interpolation.  Given the x and y values of the
/// data points, it returns the coefficients (a, b, c, d) for the piecewise cubic functions.
fn compute_cubic_spline_coefficients(
  x: &Array1<f32>,
  y: &ArrayView1<f32>,
) -> (Array1<f32>, Array1<f32>, Array1<f32>, Array1<f32>) {
  let n = x.len() - 1;

  // Compute the intervals (h) between consecutive x values.
  let h = x.slice(s![1..]).to_owned() - &x.slice(s![..n]);

  let y_diff1 = &y.slice(s![2..]) - &y.slice(s![1..n]);
  let y_diff2 = &y.slice(s![1..n]) - &y.slice(s![..n - 1]);
  let x_diff1 = h.slice(s![1..]);
  let x_diff2 = h.slice(s![..n - 1]);

  let y_over_x1 = y_diff1 / x_diff1;
  let y_over_x2 = y_diff2 / x_diff2;
  let y_over_x_diff = y_over_x1 - y_over_x2;
  let alpha = 3.0 * y_over_x_diff;

  let mut l = Array1::<f32>::zeros(n + 1);
  let mut mu = Array1::<f32>::zeros(n);
  let mut z = Array1::<f32>::zeros(n + 1);
  l[0] = 1.0;

  // Compute l, mu, and z values needed to compute the second derivatives c.
  for i in 1..n {
    l[i] = 2.0 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i - 1] - h[i - 1] * z[i - 1]) / l[i];
  }

  l[n] = 1.0;

  // Backward substitution to compute the second derivatives (c).
  let mut c = Array1::<f32>::zeros(n + 1);
  let mut b = Array1::<f32>::zeros(n);
  let mut d = Array1::<f32>::zeros(n);

  for i in (0..n).rev() {
    c[i] = z[i] - mu[i] * c[i + 1];

    // Compute first derivatives (b) and the third derivatives (d).
    b[i] = (y[i + 1] - y[i]) / h[i] - h[i] * (c[i + 1] + 2.0 * c[i]) / 3.0;
    d[i] = (c[i + 1] - c[i]) / (3.0 * h[i]);
  }

  // Return the coefficients for the piecewise cubic functions: a (the input y values), b, c, and d.
  (
    y.slice(s![..n]).to_owned(),
    b,
    c.slice(s![..n]).to_owned(),
    d,
  )
}

/// Evaluates a cubic spline at a given x value.  It takes the x value, the corresponding x-value
/// (xi) of the data point, and the coefficients (yi, bi, ci, di) of the piecewise cubic function,
/// and returns the interpolated y value at the given x.
fn eval_spline(x: f32, xi: f32, yi: f32, bi: f32, ci: f32, di: f32) -> f32 {
  let dx = x - xi;
  yi + bi * dx + ci * dx.powi(2) + di * dx.powi(3)
}

fn clamp(x: f32, min: f32, max: f32) -> f32 {
  if x < min {
    min
  } else if x > max {
    max
  } else {
    x
  }
}

pub const SAMPLE_RATE: f32 = 44_100.;
pub const NYQUIST: f32 = SAMPLE_RATE / 2.;

fn frequency_bin_to_pixel(bin_index: usize, num_bins: usize, canvas_width: f32) -> Option<f32> {
  let min_log_freq = 10.0f32;

  let bin_frequency = (bin_index as f32) * NYQUIST / (num_bins as f32);
  if bin_frequency < min_log_freq {
    return None;
  }

  let log_min_freq = (min_log_freq).log10();
  let log_max_freq = NYQUIST.log10();
  let log_freq_range = log_max_freq - log_min_freq;

  let log_bin_frequency = bin_frequency.max(min_log_freq).log10();
  let log_position = (log_bin_frequency - log_min_freq) / log_freq_range;

  Some(log_position * canvas_width)
}

/// Assumes that frequency bins are spaced linearly, but will plot them on a log10 scale.
pub(crate) fn draw_cubic_spline(
  canvas_width: u32,
  canvas_height: u32,
  y_values: &ArrayView1<f32>,
  points_per_pixel: u32,
  mut plot_pixel: impl FnMut(f32, f32),
) {
  // TODO: optimize?
  let mut x_values = Vec::with_capacity(y_values.len());
  for bin_ix in 0..y_values.len() {
    let x = frequency_bin_to_pixel(bin_ix, y_values.len(), canvas_width as f32);
    if let Some(x) = x {
      x_values.push(x);
    }
  }
  let x_values = Array1::from(x_values);
  // Trim y values to match x values.
  let y_values = y_values.slice(s![..x_values.len()]);

  let n = y_values.len() - 1;

  let (a, b, c, d) = compute_cubic_spline_coefficients(&x_values, &y_values);

  for i in 0..n {
    let x_start = x_values[i];
    let x_end = x_values[i + 1];
    let step = (x_end - x_start) / (points_per_pixel as f32);

    let mut x = x_start;
    while x < x_end {
      let y = eval_spline(x, x_values[i], a[i], b[i], c[i], d[i]);
      let y_pixel = (canvas_height as f32 - 1.0) * (1.0 - y); // Re-normalize y to canvas_height
      let y_pixel = clamp(y_pixel, 0.0, canvas_height as f32 - 1.0);
      plot_pixel(x, y_pixel);

      x += step;
    }
  }
}

#[cfg(test)]
mod test {
  use ndarray::prelude::*;
  use textplots::{Chart, Plot, Shape};

  pub fn plot_points(points: &[(f32, f32)], xmax: f32) {
    Chart::new(400, 100, 0., xmax)
      .lineplot(&Shape::Lines(&points))
      .display();
  }

  #[test]
  fn test_cubic_spline() {
    let xmax = 1.;
    let point_count = 16;
    let x_values = Array1::linspace(0.0, xmax, point_count);
    let points = vec![
      0.0, 0.5, 0.5, 1.0, 0.0, 1., 0.2, 0.8, 0.5, 0.5, 0.8, 0.2, 1.0, 0.0, 0.5, 0.5,
    ];
    assert_eq!(x_values.len(), points.len());
    let y_values = Array1::from(points);
    let y_values: ArrayView1<f32> = y_values.slice(s![..]);

    let (a, b, c, d) = super::compute_cubic_spline_coefficients(&x_values, &y_values);

    let mut points = Vec::new();
    for i in 0..point_count - 1 {
      let x_start = x_values[i];
      let x_end = x_values[i + 1];
      let step = (x_end - x_start) / 100.0;

      let mut x = x_start;
      while x < x_end {
        let y = super::eval_spline(x, x_values[i], a[i], b[i], c[i], d[i]);
        points.push((x, y));

        x += step;
      }
    }

    dbg!(&points);
    plot_points(&points, xmax);
  }
}
