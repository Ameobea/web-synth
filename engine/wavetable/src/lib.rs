#![feature(nll, box_syntax)]

use std::mem::{self, transmute};

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

impl WaveTable {
    pub fn new(settings: WaveTableSettings) -> Self {
        let wavetable_data_size = settings.get_wavetable_size();
        WaveTable {
            settings,
            samples: vec![-1.0; wavetable_data_size],
        }
    }

    fn sample_waveform(&self, dimension_ix: usize, waveform_ix: usize, sample_ix: f32) -> f32 {
        let waveform_offset_samples = (dimension_ix * self.settings.get_samples_per_dimension())
            + (waveform_ix * self.settings.waveform_length);

        let sample_mix = sample_ix.fract();
        let (sample_low_ix, sample_hi_ix) = (sample_ix.floor() as usize, sample_ix.ceil() as usize);
        let (low_sample, high_sample) = (
            self.samples[waveform_offset_samples + sample_low_ix],
            self.samples[waveform_offset_samples + sample_hi_ix],
        );

        mix(sample_mix, low_sample, high_sample)
    }

    fn sample_dimension(&self, dimension_ix: usize, waveform_ix: f32, sample_ix: f32) -> f32 {
        let waveform_mix = waveform_ix.fract();
        let (waveform_low_ix, waveform_hi_ix) =
            (waveform_ix.floor() as usize, waveform_ix.ceil() as usize);

        let low_sample = self.sample_waveform(dimension_ix, waveform_low_ix, sample_ix);
        let high_sample = self.sample_waveform(dimension_ix, waveform_hi_ix, sample_ix);

        mix(waveform_mix, low_sample, high_sample)
    }

    pub fn get_sample(&self, sample_ix: f32, mixes: &[f32]) -> f32 {
        debug_assert!(sample_ix < (self.settings.waveform_length - 1) as f32);

        let waveform_ix = mixes[0] * ((self.settings.waveforms_per_dimension - 1) as f32);
        let base_sample = self.sample_dimension(0, waveform_ix, sample_ix);

        // For each higher dimension, mix the base sample from the lowest dimension with the output
        // of the next dimension until a final sample is produced
        let mut sample = base_sample;
        for dimension_ix in 1..self.settings.dimension_count {
            let waveform_ix =
                mixes[dimension_ix * 2] * ((self.settings.waveforms_per_dimension - 1) as f32);
            let sample_for_dimension = self.sample_dimension(dimension_ix, waveform_ix, sample_ix);
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
    let settings = WaveTableSettings {
        waveforms_per_dimension,
        dimension_count,
        waveform_length,
        base_frequency,
    };

    Box::into_raw(box WaveTable::new(settings))
}

#[no_mangle]
pub fn get_data_table_ptr(handle_ptr: *mut WaveTable) -> *mut f32 {
    unsafe { (*handle_ptr).samples.as_mut_ptr() }
}

#[no_mangle]
pub fn drop_wavetable(table: *mut WaveTable) { drop(unsafe { Box::from_raw(table) }) }

#[no_mangle]
pub fn init_wavetable_handle(table: *mut WaveTable) -> *mut WaveTableHandle {
    Box::into_raw(box WaveTableHandle::new(unsafe { transmute(table) }))
}

#[no_mangle]
pub fn get_mixes_ptr(handle_ptr: *mut WaveTableHandle, sample_count: usize) -> *mut f32 {
    let mut handle = unsafe { Box::from_raw(handle_ptr) };

    while handle.sample_buffer.len() < sample_count {
        handle.sample_buffer.push(0.0);
    }

    while handle.mixes.len() < sample_count * handle.table.settings.dimension_count * 2 {
        handle.mixes.push(0.0);
    }

    let mixes_ptr = handle.mixes.as_mut_ptr();

    mem::forget(handle);

    mixes_ptr
}

#[no_mangle]
pub fn get_frequencies_ptr(handle_ptr: *mut WaveTableHandle, sample_count: usize) -> *mut f32 {
    let mut handle = unsafe { Box::from_raw(handle_ptr) };

    while handle.frequencies_buffer.len() < sample_count {
        handle.frequencies_buffer.push(440.0);
    }

    let frequencies_ptr = handle.frequencies_buffer.as_mut_ptr();

    mem::forget(handle);

    frequencies_ptr
}

#[no_mangle]
pub fn get_samples(handle_ptr: *mut WaveTableHandle, sample_count: usize) -> *const f32 {
    let mut handle = unsafe { Box::from_raw(handle_ptr) };

    while handle.sample_buffer.len() < sample_count {
        handle.sample_buffer.push(0.0);
    }

    for sample_ix in 0..sample_count {
        for dimension_ix in 0..handle.table.settings.dimension_count {
            handle.mixes_for_sample[dimension_ix * 2] =
                handle.mixes[(dimension_ix * 2 * sample_count) + sample_ix];
            handle.mixes_for_sample[dimension_ix * 2 + 1] =
                handle.mixes[(dimension_ix * 2 * sample_count) + sample_count + sample_ix];
        }

        let frequency = handle.frequencies_buffer[sample_ix];
        handle.sample_buffer[sample_ix] = handle.get_sample(frequency);
    }

    let sample_buf_ptr = handle.sample_buffer.as_ptr();

    mem::forget(handle);

    sample_buf_ptr
}

#[no_mangle]
pub fn drop_wavetable_handle(handle_ptr: *mut WaveTableHandle) {
    drop(unsafe { Box::from_raw(handle_ptr) })
}
