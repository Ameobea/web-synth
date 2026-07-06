use std::sync::Mutex;

use super::{
  param_source::ParamSource,
  samples::SampleMappingEmitter,
  synth::{
    fm_synth_add_sample, fm_synth_get_sample_buf_ptr, gate, init_fm_synth_ctx, ungate,
    FMSynthContext, OscillatorSource,
  },
};
use dsp::FRAME_SIZE;

// The synth relies on process-wide statics (sample manager, MIDI control values), so tests must
// not run concurrently.
static TEST_LOCK: Mutex<()> = Mutex::new(());

unsafe fn mk_ctx() -> *mut FMSynthContext {
  let ctx = init_fm_synth_ctx();
  // `init_fm_synth_ctx` installs a raw panic hook that swallows test assertion messages
  let _ = std::panic::take_hook();
  // operator 0 stays the default sine oscillator; give it a constant output weight of 1
  (*ctx).modulation_matrix.output_weights[0] = ParamSource::from_parts(1, 0, 1., 0., 0.);
  (*ctx).update_operator_enabled_statuses();
  ctx
}

unsafe fn render_frames(ctx: *mut FMSynthContext, frame_count: usize) -> Vec<f32> {
  let mut out = Vec::with_capacity(frame_count * FRAME_SIZE);
  for _ in 0..frame_count {
    (*ctx).generate(120., 0.);
    out.extend_from_slice(&(*ctx).main_output_buffer);
  }
  out
}

fn assert_shifted_eq(reference: &[f32], shifted: &[f32], offset: usize) {
  assert!(
    shifted[..offset].iter().all(|&s| s == 0.),
    "expected silence before sample offset {offset}"
  );
  for k in 0..reference.len() - offset {
    assert_eq!(
      reference[k],
      shifted[k + offset],
      "mismatch at voice-local sample {k}"
    );
  }
}

#[test]
fn mid_frame_gate_shifts_output_exactly() {
  let _guard = TEST_LOCK.lock().unwrap();
  unsafe {
    let a = mk_ctx();
    gate(a, 69, 90, 0);
    let reference = render_frames(a, 4);
    assert!(reference.iter().any(|&s| s.abs() > 0.01), "synth is silent");

    let offset = 37usize;
    let b = mk_ctx();
    gate(b, 69, 90, offset as u32);
    let shifted = render_frames(b, 4);

    assert_shifted_eq(&reference, &shifted, offset);
  }
}

#[test]
fn same_frame_attack_release_applies_in_offset_order() {
  let _guard = TEST_LOCK.lock().unwrap();
  unsafe {
    let ctx = mk_ctx();
    // queued out of order: the release lands later in the frame but is submitted first.  If
    // events were applied in submission order the release would find no playing note and the
    // attack would leave a stuck voice.
    ungate(ctx, 60, 90);
    gate(ctx, 60, 100, 10);
    (*ctx).generate(120., 0.);

    assert!((*ctx).polysynth.voices.iter().all(|v| !v.is_playing()));
  }
}

#[test]
fn sample_mapping_mid_frame_start() {
  let _guard = TEST_LOCK.lock().unwrap();

  unsafe fn mk_sample_ctx() -> *mut FMSynthContext {
    let ctx = mk_ctx();
    for voice in &mut *(*ctx).voices {
      voice.operators[0].oscillator_source =
        OscillatorSource::SampleMapping(SampleMappingEmitter::new());
    }

    let sample_ix = fm_synth_add_sample(64);
    let buf_ptr = fm_synth_get_sample_buf_ptr(sample_ix) as *mut f32;
    for i in 0..64 {
      *buf_ptr.add(i) = (i as f32) / 64.;
    }

    let cfg = &mut (*ctx).sample_mapping_manager.config_by_operator[0];
    cfg.set_mapped_sample_midi_number_count(1);
    cfg.set_mapped_sample_data_for_midi_number(0, 60, 1);
    cfg.set_mapped_sample_config_for_midi_number(0, 0, sample_ix as isize, false, 1., 0, 0, 1.);
    ctx
  }

  unsafe {
    let a = mk_sample_ctx();
    gate(a, 60, 90, 0);
    let reference = render_frames(a, 2);
    assert!(reference.iter().any(|&s| s.abs() > 0.01), "sampler is silent");

    let offset = 100usize;
    let b = mk_sample_ctx();
    gate(b, 60, 90, offset as u32);
    let shifted = render_frames(b, 2);

    assert_shifted_eq(&reference, &shifted, offset);
  }
}
