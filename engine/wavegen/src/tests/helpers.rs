use textplots::{Chart, Plot, Shape};

pub fn plot_wave(samples: &[f32]) {
  let points: Vec<(f32, f32)> = samples
    .iter()
    .enumerate()
    .map(|(i, &s)| {
      let x = i as f32 / samples.len() as f32;
      (x, s)
    })
    .collect();
  Chart::new(400, 100, 0., 1.)
    .lineplot(&Shape::Lines(&points))
    .display();
}
