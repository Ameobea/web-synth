use std::{
  cmp::{Eq, Ord, PartialOrd},
  collections::BinaryHeap,
};

use float_ord::FloatOrd;
use slotmap::{DefaultKey, SlotMap};

const FRAME_SIZE: usize = 128;
const SAMPLE_RATE: usize = 44_100;

/// A "note" for the sample editor.  These are the fundamental units of the sample editor.
#[derive(Clone, PartialEq)]
pub struct Sample {
  pub start_pos_beats: f64,
  pub sample_data_ix: usize,
  pub gain_envelope: Option<Vec<f32>>,
}

impl Eq for Sample {}

impl Ord for Sample {
  fn cmp(&self, other: &Self) -> std::cmp::Ordering {
    FloatOrd(self.start_pos_beats)
            .cmp(&FloatOrd(other.start_pos_beats))
            // reverse ordering to make the binary heap into a min heap
            .reverse()
  }
}

impl PartialOrd for Sample {
  fn partial_cmp(&self, other: &Sample) -> Option<std::cmp::Ordering> {
    Some(
      FloatOrd(self.start_pos_beats)
                .cmp(&FloatOrd(other.start_pos_beats))
                // reverse ordering to make the binary heap into a min heap
                .reverse(),
    )
  }
}

fn compute_sample_len_beats(len_samples: usize, bpm: f64) -> f64 {
  let bps = bpm / 60.;
  ((len_samples as f64) / (SAMPLE_RATE as f64)) * bps
}

/// Represents an actively playing sample.  The sample is read out of the data buffer
/// sample-by-sample until the whole thing has been played.  Once that point is reached, the
/// playhead is deleted.
pub struct Playhead {
  pub sample_key: u64,
  pub sample_data_ix: usize,
  pub played_sample_count: usize,
}

#[derive(PartialEq)]
pub enum PlayStatus {
  DonePlaying,
  NotDonePlaying,
}

impl Playhead {
  pub fn render(&mut self, sample_data: &[Vec<f32>], output_buf: &mut [f32]) -> PlayStatus {
    let sample_data = &sample_data[self.sample_data_ix];
    for i in 0..output_buf.len() {
      output_buf[i] += sample_data[self.played_sample_count];
      self.played_sample_count += 1;
      if self.played_sample_count >= sample_data.len() {
        return PlayStatus::DonePlaying;
      }
    }

    PlayStatus::NotDonePlaying
  }
}

pub struct SampleEditorCtx {
  pub samples: SlotMap<DefaultKey, Sample>,
  pub sample_data: Vec<Vec<f32>>,
  pub playheads: Vec<Playhead>,
  pub output_buffer: [f32; FRAME_SIZE],
  pub upcoming_samples: BinaryHeap<(u64, Sample)>,
}

impl Default for SampleEditorCtx {
  fn default() -> Self {
    Self {
      samples: SlotMap::default(),
      sample_data: Vec::new(),
      playheads: Vec::new(),
      output_buffer: [0.; FRAME_SIZE],
      upcoming_samples: BinaryHeap::default(),
    }
  }
}

impl SampleEditorCtx {
  pub fn schedule_samples(&mut self, start_beat: f64, bpm: f64) {
    self.upcoming_samples.clear();
    self.playheads.clear();

    // Find all samples that would be started but not finished at the start point and create
    // playheads for them
    for (sample_key, sample) in &self.samples {
      if sample.start_pos_beats > start_beat {
        continue;
      }

      let sample_len_samples = self.sample_data[sample.sample_data_ix].len();
      let sample_len_beats = compute_sample_len_beats(sample_len_samples, bpm);
      let end_beat = sample.start_pos_beats + sample_len_beats;

      if end_beat < start_beat {
        continue;
      }

      let pct_complete = (start_beat - sample.start_pos_beats) / sample_len_beats;
      assert!(pct_complete >= 0.);
      assert!(pct_complete <= 1.);
      let start_sample_ix = (pct_complete * (sample_len_samples as f64)).trunc() as usize;
      assert!(start_sample_ix < sample_len_samples);
      self.playheads.push(Playhead {
        sample_key: unsafe { std::mem::transmute(sample_key) },
        sample_data_ix: sample.sample_data_ix,
        played_sample_count: start_sample_ix,
      })
    }

    self.upcoming_samples.extend(
      self
        .samples
        .iter()
        .map(|(key, sample)| -> (u64, _) { (unsafe { std::mem::transmute(key) }, sample.clone()) })
        .filter(|(_key, sample)| sample.start_pos_beats > start_beat),
    );
  }
}

#[no_mangle]
pub extern "C" fn init_sample_editor_ctx() -> *mut SampleEditorCtx {
  let ctx = Box::new(SampleEditorCtx::default());
  Box::into_raw(ctx)
}

/// If `sample_ix` is negative, a new entry will be created.  Otherwise, the sample at `sample_ix`
/// will be overwritten.  Returns the index of the sample data buffer that cna be written to.
#[no_mangle]
pub extern "C" fn write_sample_data(
  ctx: *mut SampleEditorCtx,
  len_samples: usize,
  sample_ix: i32,
) -> usize {
  let ctx = unsafe { &mut *ctx };
  if sample_ix > 0 {
    let sample_ix = sample_ix as usize;
    // We're overwriting an existing sample data buffer
    let old_len = ctx.sample_data[sample_ix].len();

    // Resize the existing buffer to fit the new sample
    ctx.sample_data[sample_ix].resize(len_samples, 0.);

    // If the length of the buffer went down, we need to go through and remove all active
    // playheads referencing that buffer which are already over that length to prevent them
    // trying to read past the end of the now-shorter buffer.
    if old_len > len_samples {
      ctx.playheads.retain(|playhead| {
        if playhead.sample_data_ix != sample_ix {
          return true;
        }

        if playhead.played_sample_count >= len_samples {
          return false;
        }
        return true;
      })
    }
    return sample_ix;
  }

  // Create a new sample entry to hold this sample
  ctx.sample_data.push(Vec::with_capacity(len_samples));
  ctx.sample_data.len() - 1
}

#[no_mangle]
pub extern "C" fn get_sample_data_buf_ptr(ctx: *mut SampleEditorCtx, buf_ix: usize) -> *mut f32 {
  unsafe { (*ctx).sample_data[buf_ix].as_mut_ptr() }
}

static mut GAIN_ENVELOPE_BUF: [f32; 255] = [0.; 255];
static mut GAIN_ENVELOPE_LEN: usize = 0;

#[no_mangle]
pub extern "C" fn set_gain_envelope_ptr(len: usize) -> *mut f32 {
  if len > 255 {
    panic!("Max gain envelope length is 255");
  }

  unsafe {
    GAIN_ENVELOPE_LEN = len;
    GAIN_ENVELOPE_BUF.as_mut_ptr()
  }
}

fn decode_gain_envelope() -> Vec<f32> {
  unsafe { &GAIN_ENVELOPE_BUF[..GAIN_ENVELOPE_LEN] }.to_owned()
}

#[no_mangle]
pub extern "C" fn create_sample(
  ctx: *mut SampleEditorCtx,
  start_pos_beats: f64,
  sample_data_ix: usize,
  has_gain_envelope: bool,
) -> u32 {
  let ctx = unsafe { &mut *ctx };
  let sample = Sample {
    start_pos_beats,
    sample_data_ix,
    gain_envelope: if has_gain_envelope {
      Some(decode_gain_envelope())
    } else {
      None
    },
  };
  let key = ctx.samples.insert(sample);
  let key: u64 = unsafe { std::mem::transmute(key) };
  if key > std::u32::MAX as u64 {
    panic!("Key larger than max u32 produced by slotmap");
  }
  key as u32
}

#[no_mangle]
pub extern "C" fn remove_sample(ctx: *mut SampleEditorCtx, key: u32) {
  let ctx = unsafe { &mut *ctx };
  let key = unsafe { std::mem::transmute(key as u64) };
  let _sample = ctx
    .samples
    .remove(key)
    .unwrap_or_else(|| panic!("{}", format!("No sample found with key={:?}", key)));

  // Remove playhead for this sample if one exists
  let key = unsafe { std::mem::transmute(key) };
  ctx.playheads.retain(|playhead| playhead.sample_key != key);
}

#[no_mangle]
pub extern "C" fn start_playback(ctx: *mut SampleEditorCtx, start_beat: f64, bpm: f64) {
  let ctx = unsafe { &mut *ctx };
  ctx.schedule_samples(start_beat, bpm);
}

#[no_mangle]
pub extern "C" fn stop_playback(ctx: *mut SampleEditorCtx) {
  let ctx = unsafe { &mut *ctx };
  ctx.upcoming_samples.clear();
  ctx.playheads.clear();
}

#[no_mangle]
pub extern "C" fn process_sample_editor(ctx: *mut SampleEditorCtx, cur_beat: f64) -> *const f32 {
  let ctx = unsafe { &mut *ctx };
  ctx.output_buffer.fill(0.);

  // Create new playheads for all notes that start in this window
  loop {
    match ctx.upcoming_samples.peek().cloned() {
      Some((sample_key, next_sample)) if next_sample.start_pos_beats > cur_beat => {
        ctx.upcoming_samples.pop();
        ctx.playheads.push(Playhead {
          sample_key,
          sample_data_ix: next_sample.sample_data_ix,
          played_sample_count: 0,
        });
      },
      _ => break,
    }
  }

  // Play from all playheads into the output buffer
  let mut i = 0;
  while i < ctx.playheads.len() {
    let playhead = &mut ctx.playheads[i];
    let is_done =
      playhead.render(&ctx.sample_data, &mut ctx.output_buffer) == PlayStatus::DonePlaying;
    if is_done {
      ctx.playheads.swap_remove(i);
    } else {
      i += 1;
    }
  }

  ctx.output_buffer.as_ptr()
}
