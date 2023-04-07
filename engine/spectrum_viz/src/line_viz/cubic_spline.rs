use ndarray::prelude::*;

/// Computes the coefficients for a cubic spline interpolation.  Given the x and y values of the
/// data points, it returns the coefficients (a, b, c, d) for the piecewise cubic functions.
#[inline(never)]
fn compute_cubic_spline_coefficients<'y>(
  x: &Array1<f32>,
  y: &'y ArrayView1<f32>,
) -> (ArrayView1<'y, f32>, Array1<f32>, Array1<f32>, Array1<f32>) {
  let n = x.len() - 1;

  // Compute the intervals (h) between consecutive x values.
  // let h = x.slice(s![1..]).to_owned() - &x.slice(s![..n]);
  let h = Array1::<f32>::from_shape_fn(n, |i| x[i + 1] - x[i]);

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
  (y.slice(s![..n]), b, c.slice(s![..n]).to_owned(), d)
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

fn frequency_bin_to_pixel(bin_ix: usize, num_bins: usize, canvas_width: f32) -> Option<f32> {
  let min_log_freq = 20.0f32;

  let bin_frequency = (bin_ix as f32) * NYQUIST / (num_bins as f32);
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

/// Estimates the length of a cubic spline segment using the trapezoidal rule.
///
/// Given the starting and ending x values and the cubic spline coefficients (bi, ci, di), this
/// function estimates the length of the curve segment between these points.
fn compute_spline_segment_length<const NUM_INTERVALS: usize>(
  start_x: f32,
  end_x: f32,
  bi: f32,
  ci: f32,
  di: f32,
) -> f32 {
  let step = (end_x - start_x) / NUM_INTERVALS as f32;

  let mut length = 0.0;
  for i in 0..NUM_INTERVALS {
    let x0 = start_x + i as f32 * step;
    let x1 = start_x + (i + 1) as f32 * step;

    let dx0 = x0 - start_x;
    let dx1 = x1 - start_x;

    let dy_dx0 = bi + 2.0 * ci * dx0 + 3.0 * di * dx0.powi(2);
    let dy_dx1 = bi + 2.0 * ci * dx1 + 3.0 * di * dx1.powi(2);

    let f0 = f32::sqrt(1.0 + dy_dx0.powi(2));
    let f1 = f32::sqrt(1.0 + dy_dx1.powi(2));

    length += 0.5 * (f0 + f1) * step;
  }

  length
}

/// Assumes that frequency bins are spaced linearly, but will plot them on a log10 scale.  Assumes
/// that `y_values` is pre-scaled to [0, (canvas_height-1)].
pub(crate) fn draw_cubic_spline(
  canvas_width: u32,
  canvas_height: u32,
  y_values: &ArrayView1<f32>,
  points_per_pixel: f32,
  mut plot_pixel: impl FnMut(f32, f32),
) {
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

    let spline_len = compute_spline_segment_length::<4>(x_start, x_end, b[i], c[i], d[i]);
    let steps = ((spline_len * points_per_pixel) as usize).max(2);

    let x_step = (x_end - x_start) / steps as f32;
    // skip last point since we'll draw it next iteration
    for step_ix in 0..(steps - 1) {
      let x = x_start + x_step * step_ix as f32;
      let y = eval_spline(x, x_values[i], a[i], b[i], c[i], d[i]);
      // flip y axis since y=0 is at the top of the canvas
      let y = clamp(y, 0., (canvas_height - 1) as f32);
      let y = (canvas_height - 1) as f32 - y;
      plot_pixel(x, y);
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
