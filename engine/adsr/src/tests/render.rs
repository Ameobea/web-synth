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
            x: 0.15713059971098267,
            y: 0.031445312500000044,
            ramper: RampFn::Exponential {
                exponent: 0.8850188509551162,
            },
        },
        AdsrStep {
            x: 0.2223175578034682,
            y: 0.10705295138888893,
            ramper: RampFn::Exponential {
                exponent: 0.519887189290095,
            },
        },
        AdsrStep {
            x: 0.28735774927745666,
            y: 0.03873697916666663,
            ramper: RampFn::Exponential {
                exponent: 1.7854620405989126,
            },
        },
        AdsrStep {
            x: 0.48474756141618497,
            y: 0.027690972222222276,
            ramper: RampFn::Exponential { exponent: 0.1 },
        },
        AdsrStep {
            x: 0.5372335621387283,
            y: 5.555555555591951e-7,
            ramper: RampFn::Exponential {
                exponent: 2.0974895471559556,
            },
        },
        AdsrStep {
            x: 0.8724259393063584,
            y: 5.555555555591951e-7,
            ramper: RampFn::Exponential {
                exponent: 0.5703031944259024,
            },
        },
        AdsrStep {
            x: 1.,
            y: 0.,
            ramper: RampFn::Exponential { exponent: 1. },
        },
    ];

    let rendered = Rc::new([0.; RENDERED_BUFFER_SIZE]);

    let release_start_phase = 0.5112897398843931;
    let mut adsr = Adsr::new(
        steps,
        Some(0.),
        24144.75,
        None,
        release_start_phase,
        rendered,
        EarlyReleaseConfig::default(),
        false,
    );
    adsr.render();

    // println!("{:?}", adsr.rendered);
    let biggest_sample_to_sample_delta = adsr
        .rendered
        .iter()
        .zip(adsr.rendered.iter().skip(1))
        .map(|(a, b)| (a - b).abs())
        .max_by(|a, b| a.partial_cmp(b).unwrap())
        .unwrap();
    println!(
        "biggest_sample_to_sample_delta: {}",
        biggest_sample_to_sample_delta
    );
    let release_sample_ix = release_start_phase * RENDERED_BUFFER_SIZE as f32;
    println!(
        "value at release point: {}",
        dsp::read_interpolated(&*adsr.rendered, release_sample_ix)
    );

    adsr.phase = 0.51;
    adsr.gate_status = GateStatus::Gated;
    adsr.render_frame(1., 0., 0.);
    println!("Phase after render_frame: {}", adsr.phase);

    println!("Cur frame output: {:?}", adsr.get_cur_frame_output());
}
