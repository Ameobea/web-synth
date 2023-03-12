use std::collections::VecDeque;

struct BufEntry {
  pub i: u32, /* This will eventually overflow and wrap, but only after 1 day straight at
               * 44100 samples/second lol */
  pub val: f32,
}

static mut MINS_BUFFER: *mut VecDeque<BufEntry> = std::ptr::null_mut();
static mut MAXS_BUFFER: *mut VecDeque<BufEntry> = std::ptr::null_mut();
static mut INPUT_BUFFER: *mut Vec<f32> = std::ptr::null_mut();
static mut LOWPASS_COEFFICIENT: f32 = 0.5;
static mut WINDOW_SIZE_SAMPLES: u32 = 800;
static mut RANGE_MULTIPLIER: f32 = -1.;

// Start it a bit higher to avoid potential underflows in sliding min/max computation
static mut CUR_SAMPLE_IX: u32 = 100_000;
static mut RANGE_ACC: f32 = 0.;

#[no_mangle]
pub unsafe extern "C" fn init(frame_size: usize) -> *mut f32 {
  MINS_BUFFER = Box::into_raw(Box::new(VecDeque::new()));
  MAXS_BUFFER = Box::into_raw(Box::new(VecDeque::new()));

  let input_buf: Vec<f32> = vec![0.; frame_size];
  INPUT_BUFFER = Box::into_raw(Box::new(input_buf));
  (*INPUT_BUFFER).as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn process() {
  for i in 0..(*INPUT_BUFFER).len() {
    let sample = (*INPUT_BUFFER)[i];

    // Update buffers, removing maxs/mins that are outside the current window
    loop {
      match (*MAXS_BUFFER).back() {
        Some(back) if back.val <= sample => {},
        _ => break,
      }
      (*MAXS_BUFFER).pop_back();
    }
    (*MAXS_BUFFER).push_back(BufEntry {
      i: CUR_SAMPLE_IX,
      val: sample,
    });
    loop {
      match (*MAXS_BUFFER).front() {
        Some(front) if front.i <= CUR_SAMPLE_IX - WINDOW_SIZE_SAMPLES => (),
        _ => break,
      }
      (*MAXS_BUFFER).pop_front();
    }

    loop {
      match (*MINS_BUFFER).back() {
        Some(back) if back.val >= sample => {},
        _ => break,
      }
      (*MINS_BUFFER).pop_back();
    }
    (*MINS_BUFFER).push_back(BufEntry {
      i: CUR_SAMPLE_IX,
      val: sample,
    });
    loop {
      match (*MINS_BUFFER).front() {
        Some(front) if front.i <= CUR_SAMPLE_IX - WINDOW_SIZE_SAMPLES => (),
        _ => break,
      }
      (*MINS_BUFFER).pop_front();
    }

    // Apply lowpass to our output and write back into the input buffer in-place
    let range = (*MAXS_BUFFER).front().unwrap().val - (*MINS_BUFFER).front().unwrap().val;
    RANGE_ACC = RANGE_ACC * LOWPASS_COEFFICIENT + range * (1. - LOWPASS_COEFFICIENT);
    (*INPUT_BUFFER)[i] = dsp::clamp(-1., 1., RANGE_ACC * RANGE_MULTIPLIER);

    CUR_SAMPLE_IX += 1;
  }
}

#[no_mangle]
pub unsafe extern "C" fn set_window_size_samples(window_size_samples: u32) {
  WINDOW_SIZE_SAMPLES = window_size_samples;
}

#[no_mangle]
pub unsafe extern "C" fn set_lowpass_coefficient(lowpass_coefficient: f32) {
  LOWPASS_COEFFICIENT = lowpass_coefficient;
}

#[no_mangle]
pub unsafe extern "C" fn set_range_multiplier(range_multiplier: f32) {
  RANGE_MULTIPLIER = range_multiplier;
}
