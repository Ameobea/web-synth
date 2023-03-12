use std::rc::Rc;

use crate::{Adsr, AdsrStep, EarlyReleaseConfig, GateStatus, RampFn, RENDERED_BUFFER_SIZE};

#[test]
fn gain_envelope_click_debug() {
  let steps = vec![
    AdsrStep {
      x: 0.,
      y: 0.,
      ramper: RampFn::Linear,
    },
    AdsrStep {
      x: 0.05458470394736842,
      y: 0.6365755208333334,
      ramper: RampFn::Exponential {
        exponent: 0.8158410073648446,
      },
      // ramper: RampFn::Linear,
    },
    AdsrStep {
      x: 0.08488384046052631,
      y: 0.,
      ramper: RampFn::Exponential {
        exponent: 1.0451204003026304,
      },
      // ramper: RampFn::Linear,
    },
    AdsrStep {
      x: 0.15620716831140352,
      y: 0.,
      ramper: RampFn::Exponential {
        exponent: 1.1669300918172727,
      },
      // ramper: RampFn::Linear,
    },
    AdsrStep {
      x: 0.19761684484649122,
      y: 0.796640625,
      ramper: RampFn::Exponential {
        exponent: 1.3254282011137977,
      },
      // ramper: RampFn::Linear,
    },
    AdsrStep {
      x: 0.6169219435307017,
      y: 0.,
      ramper: RampFn::Exponential {
        exponent: 1.0972947217540114,
      },
      // ramper: RampFn::Linear,
    },
    AdsrStep {
      x: 1.,
      y: 0.,
      ramper: RampFn::Exponential {
        exponent: 0.693064116137214,
      },
      // ramper: RampFn::Linear,
    },
  ];

  let rendered = Rc::new([0.; RENDERED_BUFFER_SIZE]);

  let release_start_phase = 0.631;
  let mut adsr = Adsr::new(
    steps,
    Some(0.),
    90_144.75,
    None,
    release_start_phase,
    rendered,
    EarlyReleaseConfig::default(),
    false,
  );
  adsr.render();

  let (biggest_sample_to_sample_ix, biggest_sample_to_sample_delta) = adsr
    .rendered
    .iter()
    .enumerate()
    .zip(adsr.rendered.iter().skip(1))
    .map(|((ix, a), b)| (ix, (b - a).abs()))
    .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
    .unwrap();
  println!(
    "biggest_sample_to_sample_ix: {biggest_sample_to_sample_ix}, delta: \
     {biggest_sample_to_sample_delta},
         phase: {}",
    biggest_sample_to_sample_ix as f32 / RENDERED_BUFFER_SIZE as f32,
  );
  let release_sample_ix = release_start_phase * RENDERED_BUFFER_SIZE as f32;
  println!(
    "value at release point: {}",
    dsp::read_interpolated(&*adsr.rendered, release_sample_ix)
  );

  adsr.phase = 0.0;
  adsr.gate_status = GateStatus::Gated;
  adsr.render_frame(1., 0., 0.);
  println!("Phase after render_frame: {}", adsr.phase);

  println!("Cur frame output: {:?}", adsr.get_cur_frame_output());
}
