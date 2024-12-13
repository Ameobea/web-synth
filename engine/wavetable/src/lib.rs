#![feature(get_mut_unchecked)]

pub mod fm;

pub static mut CUR_BPM: f32 = 0.;

#[no_mangle]
pub unsafe extern "C" fn set_cur_bpm(bpm: f32) { CUR_BPM = bpm; }

pub fn get_cur_bpm() -> f32 { unsafe { CUR_BPM } }

pub struct WaveTableSettings {
  /// Number of `f32` samples in a single waveform
  pub waveform_length: usize,
  /// Number of dimensions in the wave table that can be mixed
  pub dimension_count: usize,
  /// Number of waveforms in each dimension
  pub waveforms_per_dimension: usize,
  /// Frequency of the samples that are stored in the wavetable
  pub base_frequency: f32,
}

impl WaveTableSettings {
  #[inline(always)]
  pub fn get_samples_per_dimension(&self) -> usize {
    self.waveforms_per_dimension * self.waveform_length
  }

  /// Returns the total number of `f32` samples that will be stored by this wavetable in all
  /// dimensions and waveforms
  pub fn get_wavetable_size(&self) -> usize {
    self.dimension_count * self.get_samples_per_dimension()
  }
}

pub struct WaveTable {
  pub settings: WaveTableSettings,
  pub samples: Vec<f32>,
}

fn mix(mix_factor: f32, low: f32, high: f32) -> f32 {
  ((1.0 - mix_factor) * low) + (mix_factor * high)
}

// const SMOOTH_TAIL_LEN_SAMPLES: usize = 16;

impl WaveTable {
  pub fn new(settings: WaveTableSettings) -> Self {
    let wavetable_data_size = settings.get_wavetable_size();
    WaveTable {
      settings,
      samples: vec![-1.0; wavetable_data_size],
    }
  }

  pub fn resize(
    &mut self,
    waveforms_per_dimension: usize,
    dimension_count: usize,
    waveform_length: usize,
  ) {
    self.settings.waveforms_per_dimension = waveforms_per_dimension;
    self.settings.dimension_count = dimension_count;
    self.settings.waveform_length = waveform_length;
    self.samples.resize(self.settings.get_wavetable_size(), 0.);
  }

  fn sample_waveform(&self, dimension_ix: usize, waveform_ix: usize, sample_ix: f32) -> f32 {
    let waveform_offset_samples = (dimension_ix * self.settings.get_samples_per_dimension())
      + (waveform_ix * self.settings.waveform_length);

    let sample_mix = sample_ix.fract();
    let (sample_low_ix, sample_hi_ix) = (
      sample_ix.floor() as usize,
      (sample_ix.ceil() as usize).min(self.samples.len() - 1),
    );

    if cfg!(debug_assertions) && waveform_offset_samples + sample_hi_ix >= self.samples.len() {
      panic!(
        "sample_hi_ix: {}, waveform_offset_samples: {}, samples.len(): {}, waveform_ix: {}, \
         dimension_ix: {}, sample_ix: {}",
        sample_hi_ix,
        waveform_offset_samples,
        self.samples.len(),
        waveform_ix,
        dimension_ix,
        sample_ix
      );
    }

    let (low_sample, high_sample) = (
      self.samples[waveform_offset_samples + sample_low_ix],
      self.samples[waveform_offset_samples + sample_hi_ix],
    );

    let base_sample = mix(sample_mix, low_sample, high_sample);
    // We mix the final `SMOOTH_TAIL_LEN_SAMPLES` samples with the first sample of the waveform
    // to avoid audio artifacts caused by discontinuities produced by wrapping around
    // let samples_from_the_end = self.settings.waveform_length - sample_low_ix;
    // if samples_from_the_end > SMOOTH_TAIL_LEN_SAMPLES {
    return base_sample;
    // }

    // let first_sample = self.samples[waveform_offset_samples];
    // mix(
    //   (SMOOTH_TAIL_LEN_SAMPLES - samples_from_the_end) as f32 / SMOOTH_TAIL_LEN_SAMPLES as f32,
    //   base_sample,
    //   first_sample,
    // )
  }

  fn sample_dimension(&self, dimension_ix: usize, waveform_ix: f32, sample_ix: f32) -> f32 {
    let waveform_mix = waveform_ix.fract();
    if waveform_mix == 0. {
      return self.sample_waveform(dimension_ix, waveform_ix as usize, sample_ix);
    }

    let (waveform_low_ix, waveform_hi_ix) =
      (waveform_ix.floor() as usize, waveform_ix.ceil() as usize);

    let low_sample = self.sample_waveform(dimension_ix, waveform_low_ix, sample_ix);
    let high_sample = self.sample_waveform(dimension_ix, waveform_hi_ix, sample_ix);

    mix(waveform_mix, low_sample, high_sample)
  }

  pub fn get_sample(&self, sample_ix: f32, mixes: &[f32]) -> f32 {
    if cfg!(debug_assertions) {
      if sample_ix < 0.0 || sample_ix >= (self.settings.waveform_length - 1) as f32 {
        panic!(
          "sample_ix: {}, waveform_length: {}",
          sample_ix, self.settings.waveform_length
        );
      }
    }

    let base_sample = if self.settings.waveforms_per_dimension == 1 {
      self.sample_waveform(0, 0, sample_ix)
    } else {
      let waveform_ix = mixes[0] * ((self.settings.waveforms_per_dimension - 1) as f32);
      self.sample_dimension(0, waveform_ix, sample_ix)
    };

    // For each higher dimension, mix the base sample from the lowest dimension with the output
    // of the next dimension until a final sample is produced
    let mut sample = base_sample;
    for dimension_ix in 1..self.settings.dimension_count {
      let waveform_ix =
        mixes[dimension_ix * 2] * ((self.settings.waveforms_per_dimension - 1) as f32);
      let sample_for_dimension = if self.settings.waveforms_per_dimension == 1 {
        self.sample_waveform(dimension_ix, 0, sample_ix)
      } else {
        self.sample_dimension(dimension_ix, waveform_ix, sample_ix)
      };
      sample = mix(mixes[dimension_ix * 2 + 1], sample, sample_for_dimension);
    }

    sample
  }
}

/// Represents a single voice playing out of an attached `WaveTable`
pub struct WaveTableHandle {
  pub table: &'static mut WaveTable,
  /// The current horizontal index in the wavetable specifying the index in the waveforms from
  /// samples will be retrieved
  pub sample_ix: f32,
  /// Buffer into which mix values for each sample for each dimension are copied from JavaScript
  pub mixes: Vec<f32>,
  /// Buffer to hold the mix values for each dimension and inter-dimensional mixes as well
  pub mixes_for_sample: Vec<f32>,
  /// The buffer into which the output from sampling the wavetable is written
  pub sample_buffer: Vec<f32>,
  /// Stores the frequencies that each of the samples should play at
  pub frequencies_buffer: Vec<f32>,
}

impl WaveTableHandle {
  pub fn new(table: &'static mut WaveTable) -> Self {
    let dimension_count = table.settings.dimension_count;

    WaveTableHandle {
      table,
      sample_ix: 0.0,
      mixes: vec![0.0; dimension_count * 2 * 128],
      mixes_for_sample: vec![0.0; dimension_count * 2],
      sample_buffer: vec![0.; 256],
      frequencies_buffer: vec![440.0; 128],
    }
  }

  fn get_sample_ix_offset(&self, frequency: f32) -> f32 {
    frequency / self.table.settings.base_frequency
  }

  pub fn get_sample(&mut self, frequency: f32) -> f32 {
    let sample = self
      .table
      .get_sample(self.sample_ix, &self.mixes_for_sample);

    self.sample_ix += self.get_sample_ix_offset(frequency);
    if self.sample_ix >= (self.table.settings.waveform_length - 1) as f32 {
      self.sample_ix %= (self.table.settings.waveform_length - 1) as f32;
    }

    sample
  }
}

#[no_mangle]
pub fn init_wavetable(
  waveforms_per_dimension: usize,
  dimension_count: usize,
  waveform_length: usize,
  base_frequency: f32,
) -> *mut WaveTable {
  common::set_raw_panic_hook(crate::fm::log_panic);

  let settings = WaveTableSettings {
    waveforms_per_dimension,
    dimension_count,
    waveform_length,
    base_frequency,
  };

  Box::into_raw(Box::new(WaveTable::new(settings)))
}

#[no_mangle]
pub fn get_data_table_ptr(handle_ptr: *mut WaveTable) -> *mut f32 {
  unsafe { (*handle_ptr).samples.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn set_base_frequency(handle_ptr: *mut WaveTable, base_frequency: f32) {
  unsafe { (*handle_ptr).settings.base_frequency = base_frequency }
}

#[no_mangle]
pub extern "C" fn resize_wavetable(
  handle_ptr: *mut WaveTable,
  waveforms_per_dimension: usize,
  dimension_count: usize,
  waveform_length: usize,
) {
  let ctx = unsafe { &mut *handle_ptr };
  ctx.resize(waveforms_per_dimension, dimension_count, waveform_length);
}

#[no_mangle]
pub unsafe fn init_wavetable_handle(table: *mut WaveTable) -> *mut WaveTableHandle {
  Box::into_raw(Box::new(WaveTableHandle::new(std::mem::transmute(table))))
}

#[no_mangle]
pub fn get_mixes_ptr(handle_ptr: *mut WaveTableHandle, sample_count: usize) -> *mut f32 {
  let handle = unsafe { &mut *handle_ptr };

  while handle.sample_buffer.len() < sample_count {
    handle.sample_buffer.push(0.0);
  }

  while handle.mixes.len() < sample_count * handle.table.settings.dimension_count * 2 {
    handle.mixes.push(0.0);
  }

  let mixes_ptr = handle.mixes.as_mut_ptr();

  mixes_ptr
}

#[no_mangle]
pub fn get_frequencies_ptr(handle_ptr: *mut WaveTableHandle, sample_count: usize) -> *mut f32 {
  let handle = unsafe { &mut *handle_ptr };

  while handle.frequencies_buffer.len() < sample_count {
    handle.frequencies_buffer.push(440.0);
  }

  let frequencies_ptr = handle.frequencies_buffer.as_mut_ptr();

  frequencies_ptr
}

#[no_mangle]
pub fn get_samples(handle_ptr: *mut WaveTableHandle, sample_count: usize) -> *const f32 {
  let handle = unsafe { &mut *handle_ptr };

  while handle.sample_buffer.len() < sample_count {
    handle.sample_buffer.push(0.0);
  }

  for sample_ix in 0..sample_count {
    let frequency = handle.frequencies_buffer[sample_ix];
    if frequency == 0.0 {
      handle.sample_buffer[sample_ix] = 0.0;
      continue;
    }

    for dimension_ix in 0..handle.table.settings.dimension_count {
      handle.mixes_for_sample[dimension_ix * 2] =
        handle.mixes[(dimension_ix * 2 * sample_count) + sample_ix];
      handle.mixes_for_sample[dimension_ix * 2 + 1] =
        handle.mixes[(dimension_ix * 2 * sample_count) + sample_count + sample_ix];
    }

    handle.sample_buffer[sample_ix] = handle.get_sample(frequency);
  }

  let sample_buf_ptr = handle.sample_buffer.as_ptr();

  sample_buf_ptr
}
