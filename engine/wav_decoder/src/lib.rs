#[macro_use]
extern crate log;

use wasm_bindgen::prelude::*;

static mut ERROR_MESSAGE: String = String::new();

#[wasm_bindgen]
pub fn get_error_message() -> String { unsafe { ERROR_MESSAGE.clone() } }

#[wasm_bindgen]
pub fn decode_wav(data: Vec<u8>) -> Vec<f32> {
  common::maybe_init(None);
  wbg_logging::maybe_init();

  let mut reader = match hound::WavReader::new(data.as_slice()) {
    Ok(r) => r,
    Err(e) => {
      error!("Error parsing wav file: {}", e);
      unsafe {
        ERROR_MESSAGE = format!("Error parsing wav file: {}", e);
      }
      return Vec::new();
    },
  };

  let spec = reader.spec();
  info!("{:?}", spec);
  let res: Result<Vec<f32>, _> = match spec.sample_format {
    hound::SampleFormat::Int => reader
      .samples::<i32>()
      .map(|res| {
        let sample = res?;
        Ok(sample as f32 / (1 << 15) as f32)
      })
      .collect::<Result<Vec<f32>, _>>(),
    hound::SampleFormat::Float => reader
      .into_samples::<f32>()
      .collect::<Result<Vec<f32>, _>>(),
  };
  match res {
    Ok(samples) => samples,
    Err(err) => {
      error!("Error decoding wav file: {:?}", err);
      unsafe {
        ERROR_MESSAGE = format!("Error decoding wav file: {:?}", err);
      }
      Vec::new()
    },
  }
}
