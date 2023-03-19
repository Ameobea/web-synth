use std::io::Cursor;

#[derive(Default)]
pub struct SampleRcorderContext {
  pub samples: Vec<f32>,
  pub encoded: Vec<u8>,
}

#[no_mangle]
pub extern "C" fn create_sample_recorder_ctx() -> *const SampleRcorderContext {
  Box::into_raw(Box::new(SampleRcorderContext::default()))
}

/// Given the number of samples to be written, returns a pointer to the spot in memory where they
/// can be written to.  The pointer points to exactly the point where the *new* samples are to be
/// written and has enough space for `sample_count_to_write` of them.
#[no_mangle]
pub unsafe extern "C" fn sample_recorder_record(
  ctx: *mut SampleRcorderContext,
  sample_count_to_write: usize,
) -> *mut f32 {
  let ctx = &mut *ctx;
  ctx.samples.reserve(sample_count_to_write);
  ctx
    .samples
    .set_len(ctx.samples.len() + sample_count_to_write);
  ctx.samples.as_mut_ptr().add(ctx.samples.len())
}

/// Returns a pointer to the sample buffer for the provided context with an offset of `offset`
/// samples.
#[no_mangle]
pub unsafe extern "C" fn sample_recorder_get_samples_ptr(
  ctx: *const SampleRcorderContext,
  offset: usize,
) -> *const f32 {
  (*ctx).samples.as_ptr().add(offset)
}

fn encode_to_wav(samples: &[f32]) -> Vec<u8> {
  let spec = hound::WavSpec {
    channels: 1,
    sample_rate: 44100,
    bits_per_sample: 32,
    sample_format: hound::SampleFormat::Float,
  };
  let mut encoded_buf = Vec::new();
  let mut writer = hound::WavWriter::new(Cursor::new(&mut encoded_buf), spec).unwrap();
  for sample in samples {
    writer.write_sample(*sample).unwrap();
  }
  writer.finalize().unwrap();
  encoded_buf
}

/// Encodes the sample into the specified format and writes it into a buffer.  Returns the length of
/// that buffer in bytes.  Call `sample_recorder_get_encoded_output_ptr` with the same context you
/// passed to this function to retrieve the pointer to that buffer.
#[no_mangle]
pub unsafe extern "C" fn sample_recorder_encode(
  ctx: *mut SampleRcorderContext,
  format: u32,
  start_sample_ix: usize,
  end_sample_ix: usize,
) -> usize {
  let ctx = &mut *ctx;
  // wav is all we support currently
  if format != 0 {
    panic!("Unsupported encoding format");
  }

  ctx.encoded = encode_to_wav(&ctx.samples[start_sample_ix..end_sample_ix]);
  ctx.encoded.len()
}

#[no_mangle]
pub unsafe extern "C" fn sample_recorder_get_encoded_output_ptr(
  ctx: *const SampleRcorderContext,
) -> *const u8 {
  (*ctx).encoded.as_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn free_sample_recording_ctx(ctx: *mut SampleRcorderContext) {
  drop(Box::from_raw(ctx))
}
