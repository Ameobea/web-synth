use dsp::midi_number_to_frequency;

use crate::fm::OPERATOR_COUNT;

use super::sample_manager;

#[derive(Clone)]
pub struct SampleMappingEmitter {
    pub cur_ix: usize,
}

impl SampleMappingEmitter {
    pub fn new() -> Self { SampleMappingEmitter { cur_ix: 0 } }

    pub fn gen_sample(&mut self, base_frequency: f32, config: &SampleMappingOperatorConfig) -> f32 {
        let mut out = 0.;

        for (_midi_number, slot_base_frequency, data) in &config.mapped_samples_by_midi_number {
            if *slot_base_frequency != base_frequency {
                continue;
            }

            for data in data {
                let sample = match data.sample {
                    Some(samp) => samp,
                    None => continue,
                };
                if self.cur_ix >= sample.len() && !data.do_loop {
                    continue;
                }
                let ix = self.cur_ix % sample.len();
                out += sample[ix];
            }
        }

        self.cur_ix += 1;
        out
    }
}

pub struct MappedSampleData {
    pub sample: Option<&'static [f32]>,
    pub do_loop: bool,
}

impl MappedSampleData {
    pub fn from_parts(sample_ix: isize, do_loop: bool) -> Self {
        MappedSampleData {
            sample: if sample_ix < 0 {
                None
            } else {
                Some(&sample_manager().samples[sample_ix as usize])
            },
            do_loop,
        }
    }
}

impl Default for MappedSampleData {
    fn default() -> MappedSampleData {
        MappedSampleData {
            sample: None,
            do_loop: false,
        }
    }
}

#[derive(Default)]
pub struct SampleMappingOperatorConfig {
    pub mapped_samples_by_midi_number: Vec<(usize, f32, Vec<MappedSampleData>)>,
}

impl SampleMappingOperatorConfig {
    pub fn set_mapped_sample_midi_number_count(&mut self, mapped_midi_number_count: usize) {
        self.mapped_samples_by_midi_number
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
        mapped_samples_for_midi_number.0 = midi_number;
        mapped_samples_for_midi_number.1 = midi_number_to_frequency(midi_number);
        mapped_samples_for_midi_number
            .2
            .resize_with(mapped_sample_count, Default::default);
    }

    pub fn set_mapped_sample_config_for_midi_number(
        &mut self,
        midi_number_ix: usize,
        mapped_sample_ix: usize,
        sample_data_ix: isize,
        do_loop: bool,
    ) {
        self.mapped_samples_by_midi_number[midi_number_ix].2[mapped_sample_ix] =
            MappedSampleData::from_parts(sample_data_ix, do_loop);
    }
}

#[derive(Default)]
pub struct SampleMappingManager {
    pub config_by_operator: [SampleMappingOperatorConfig; OPERATOR_COUNT],
}