use crate::fm::OPERATOR_COUNT;

use super::sample_manager;

#[derive(Clone)]
pub struct SampleMappingEmitter {
  pub phases: Vec<f32>,
}

impl SampleMappingEmitter {
  pub fn new() -> Self {
    SampleMappingEmitter {
      phases: Vec::with_capacity(16),
    }
  }

  pub fn reset_phases(&mut self) { self.phases.fill(0.); }

  fn advance_phases(&mut self, mapped_sample_data: &[MappedSampleData]) {
    while self.phases.len() < mapped_sample_data.len() {
      self.phases.push(0.);
    }

    for i in 0..mapped_sample_data.len() {
      let MappedSampleData {
        do_loop,
        start_ix,
        end_ix,
        sample,
        playback_rate,
        gain: _,
      } = &mapped_sample_data[i];
      if let Some(_sample) = sample {
        let len = end_ix - start_ix;
        if len == 0 {
          continue;
        }
        let phase = &mut self.phases[i];
        *phase += (1. / len as f32) * playback_rate;
        if *phase >= 1. {
          if *do_loop {
            *phase -= 1.;
          } else {
            *phase = -1000.;
          }
        }
      }
    }
  }

  pub fn gen_sample(&mut self, midi_number: usize, config: &SampleMappingOperatorConfig) -> f32 {
    let mut out = 0.;

    for MappedSample {
      midi_number: slot_midi_number,
      data,
    } in &config.mapped_samples_by_midi_number
    {
      if *slot_midi_number != midi_number || data.is_empty() {
        continue;
      }

      self.advance_phases(data);

      for (i, data) in data.iter().enumerate() {
        let sample = match data.sample {
          Some(samp) => samp,
          None => continue,
        };
        let phase = self.phases[i];
        if phase < -10. {
          continue;
        }
        let buf = &sample[data.start_ix..data.end_ix];
        if buf.len() < 2 {
          continue;
        }
        out += dsp::read_interpolated(buf, phase * (buf.len() - 1) as f32) * data.gain;
      }
    }

    out
  }
}

pub struct MappedSampleData {
  pub sample: Option<&'static [f32]>,
  pub do_loop: bool,
  pub gain: f32,
  pub start_ix: usize,
  pub end_ix: usize,
  pub playback_rate: f32,
}

impl MappedSampleData {
  pub fn from_parts(
    sample_ix: isize,
    do_loop: bool,
    gain: f32,
    start_ix: usize,
    end_ix: usize,
    playback_rate: f32,
  ) -> Self {
    let (sample, start_ix, end_ix) = if sample_ix < 0 {
      (None, 0, 0)
    } else {
      let sample = sample_manager().samples[sample_ix as usize].as_slice();
      (
        Some(sample),
        start_ix.min(sample.len()),
        if end_ix == 0 {
          sample.len()
        } else {
          end_ix.min(sample.len())
        },
      )
    };

    MappedSampleData {
      sample,
      do_loop,
      gain,
      start_ix,
      end_ix,
      playback_rate,
    }
  }
}

impl Default for MappedSampleData {
  fn default() -> MappedSampleData {
    MappedSampleData {
      sample: None,
      do_loop: false,
      gain: 1.,
      start_ix: 0,
      end_ix: 0,
      playback_rate: 1.,
    }
  }
}

#[derive(Default)]
pub struct MappedSample {
  pub midi_number: usize,
  pub data: Vec<MappedSampleData>,
}

#[derive(Default)]
pub struct SampleMappingOperatorConfig {
  pub mapped_samples_by_midi_number: Vec<MappedSample>,
}

impl SampleMappingOperatorConfig {
  pub fn set_mapped_sample_midi_number_count(&mut self, mapped_midi_number_count: usize) {
    self
      .mapped_samples_by_midi_number
      .resize_with(mapped_midi_number_count, Default::default);
  }

  pub fn set_mapped_sample_data_for_midi_number(
    &mut self,
    midi_number_slot_ix: usize,
    midi_number: usize,
    mapped_sample_count: usize,
  ) {
    let mapped_samples_for_midi_number =
      &mut self.mapped_samples_by_midi_number[midi_number_slot_ix];
    mapped_samples_for_midi_number.midi_number = midi_number;
    mapped_samples_for_midi_number
      .data
      .resize_with(mapped_sample_count, Default::default);
  }

  pub fn set_mapped_sample_config_for_midi_number(
    &mut self,
    midi_number_ix: usize,
    mapped_sample_ix: usize,
    sample_data_ix: isize,
    do_loop: bool,
    gain: f32,
    start_ix: usize,
    end_ix: usize,
    playback_rate: f32,
  ) {
    self.mapped_samples_by_midi_number[midi_number_ix].data[mapped_sample_ix] =
      MappedSampleData::from_parts(
        sample_data_ix,
        do_loop,
        gain,
        start_ix,
        end_ix,
        playback_rate,
      );
  }
}

#[derive(Default)]
pub struct SampleMappingManager {
  pub config_by_operator: [SampleMappingOperatorConfig; OPERATOR_COUNT],
}
