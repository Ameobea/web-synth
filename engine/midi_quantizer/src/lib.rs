use common::ref_static_mut;

extern "C" {
  fn play_note(note: usize);

  fn release_note(note: usize);
}

const NOTES_PER_OCTAVE: usize = 12;
const C0: usize = 24;

pub struct MIDIQuantizerState {
  pub is_running: bool,
  pub octave_range: [isize; 2],
  pub active_note_flags: [bool; 12],
  pub active_note_ids: Vec<usize>,
  pub last_sample: f32,
  pub playing_note: Option<usize>,
}

impl MIDIQuantizerState {
  pub const fn default() -> Self {
    MIDIQuantizerState {
      is_running: false,
      octave_range: [0; 2],
      active_note_flags: [false; 12],
      active_note_ids: Vec::new(),
      last_sample: -200.,
      playing_note: None,
    }
  }

  pub fn quantize_sample(&self, sample: f32) -> usize {
    let sample_from_0_to_1 = dsp::clamp(0., 1., (sample + 1.) / 2.);
    let index = sample_from_0_to_1 * (self.active_note_ids.len() - 1) as f32;
    let index = index.round();
    self.active_note_ids[index as usize]
  }
}

static mut STATE: MIDIQuantizerState = MIDIQuantizerState::default();
fn state() -> &'static mut MIDIQuantizerState { ref_static_mut!(STATE) }

#[no_mangle]
pub extern "C" fn set_octave_range(low: isize, high: isize) {
  state().octave_range = [low.max(-2).min(6), high.max(-2).min(6)];
}

#[no_mangle]
pub extern "C" fn set_note_active(note_ix: usize, is_active: bool) {
  state().active_note_flags[note_ix] = is_active;
}

#[no_mangle]
pub extern "C" fn set_is_running(is_running: bool) {
  if state().is_running == is_running {
    return;
  }
  state().is_running = is_running;

  if !is_running {
    if let Some(note) = state().playing_note {
      unsafe { release_note(note) };
    }
    state().playing_note = None;
    state().last_sample = -200.;
  }
}

#[no_mangle]
pub extern "C" fn finalize_state_update() {
  let state = state();

  state.active_note_ids.clear();
  for octive_ix in state.octave_range[0]..=state.octave_range[1] {
    let note_offset_from_c0 = C0 as isize + octive_ix * (NOTES_PER_OCTAVE as isize);
    for (note_ix, is_active) in state.active_note_flags.iter().enumerate() {
      if !is_active {
        continue;
      }
      state
        .active_note_ids
        .push(note_offset_from_c0 as usize + note_ix);
    }
  }
}

#[no_mangle]
pub extern "C" fn process(sample: f32) {
  let state = state();
  if !state.is_running || state.active_note_ids.is_empty() {
    return;
  }

  let sample = dsp::clamp_normalize(-1., 1., sample);

  if state.last_sample < -100. {
    state.last_sample = sample;
    return;
  }

  if sample == state.last_sample {
    return;
  }
  state.last_sample = sample;

  // Input signal has changed; emit a note if the new quantized note is different than the
  // previous
  let note = state.quantize_sample(sample);
  if state.playing_note == Some(note) {
    return;
  }

  if let Some(playing_note) = state.playing_note {
    unsafe { release_note(playing_note) };
  }
  unsafe { play_note(note) };
  state.playing_note = Some(note);
}
