#[derive(Clone, Default)]
pub struct ADSRState {
    // TODO
}

#[derive(Clone, Default)]
pub struct SineOscillator {
    pub phase: f32,
}

impl SineOscillator {
    pub fn gen_sample(&mut self, frequency: f32) -> f32 {
        // 1 phase corresponds to 1 period of the waveform.  1 phase is passed every (SAMPLE_RATE /
        // frequency) samples.
        if frequency.is_normal() && frequency.abs() > 0.001 {
            self.phase = (self.phase + (1. / (SAMPLE_RATE as f32 / frequency))).fract();
            if self.phase < 0. {
                self.phase = 1. + self.phase;
            }
        }

        // unsafe {
        //     *crate::lookup_tables::SINE_LOOKUP_TABLE.get_unchecked(
        //         (self.phase * (crate::lookup_tables::SINE_LOOKUP_TABLE.len() - 1) as f32) as
        // usize,     )
        // }
        dsp::read_interpolated(
            &crate::lookup_tables::SINE_LOOKUP_TABLE,
            self.phase * (crate::lookup_tables::SINE_LOOKUP_TABLE.len() - 2) as f32,
        )
    }
}

#[derive(Clone)]
pub enum OscillatorSource {
    Wavetable(usize),
    ParamBuffer(usize),
    Sine(SineOscillator),
}

impl Default for OscillatorSource {
    fn default() -> Self { OscillatorSource::Sine(SineOscillator::default()) }
}

impl OscillatorSource {
    pub fn gen_sample(
        &mut self,
        frequency: f32,
        wavetables: &mut [()],
        param_buffers: &[[f32; FRAME_SIZE]],
        sample_ix_within_frame: usize,
    ) -> f32 {
        match self {
            OscillatorSource::Wavetable(wavetable_ix) => {
                // TODO
                -1.0
            },
            OscillatorSource::ParamBuffer(buf_ix) => param_buffers[*buf_ix][sample_ix_within_frame],
            OscillatorSource::Sine(osc) => osc.gen_sample(frequency),
        }
    }
}

#[derive(Clone, Default)]
pub struct FMSynthVoice {
    pub output: f32,
    pub adsrs: Vec<ADSRState>,
    pub operators: [OscillatorSource; OPERATOR_COUNT],
    pub last_samples: [f32; OPERATOR_COUNT],
    pub last_sample_frequencies_per_operator: [f32; OPERATOR_COUNT],
}

/// Applies modulation from all other operators to the provided frequency, returning the modulated
/// frequency
fn compute_modulated_frequency(
    modulation_matrix: &ModulationMatrix,
    last_samples: &[f32; OPERATOR_COUNT],
    param_buffers: &[[f32; FRAME_SIZE]],
    adsrs: &[ADSRState],
    operator_ix: usize,
    sample_ix_within_frame: usize,
    carrier_base_frequency: f32,
    last_sample_modulator_frequencies: &[f32; OPERATOR_COUNT],
) -> f32 {
    let mut output_freq = carrier_base_frequency;
    for modulator_operator_ix in 0..OPERATOR_COUNT {
        let modulator_output = last_samples[modulator_operator_ix];
        let modulation_index = modulation_matrix
            .get_operator_modulation_index(modulator_operator_ix, operator_ix)
            .get(param_buffers, adsrs, sample_ix_within_frame);
        output_freq += modulator_output
            * modulation_index
            * last_sample_modulator_frequencies[modulator_operator_ix];
    }
    output_freq
}

impl FMSynthVoice {
    pub fn gen_sample(
        &mut self,
        modulation_matrix: &ModulationMatrix,
        wavetables: &mut [()],
        param_buffers: &[[f32; FRAME_SIZE]],
        sample_ix_within_frame: usize,
        operator_base_frequency_sources: &[OperatorFrequencySource; OPERATOR_COUNT],
        base_frequency: f32,
    ) -> f32 {
        // TODO: Update ADSR state

        let mut samples_per_operator: [f32; OPERATOR_COUNT] = [0.0f32; OPERATOR_COUNT];
        let mut frequencies_per_operator: [f32; OPERATOR_COUNT] = [0.0f32; OPERATOR_COUNT];
        let mut output_sample = 0.0f32;

        for operator_ix in 0..OPERATOR_COUNT {
            let carrier_base_frequency =
                unsafe { *operator_base_frequency_sources.get_unchecked(operator_ix) }.get(
                    param_buffers,
                    &self.adsrs,
                    sample_ix_within_frame,
                    base_frequency,
                );
            let modulated_frequency = compute_modulated_frequency(
                modulation_matrix,
                &self.last_samples,
                param_buffers,
                &self.adsrs,
                operator_ix,
                sample_ix_within_frame,
                carrier_base_frequency,
                &self.last_sample_frequencies_per_operator,
            );
            frequencies_per_operator[operator_ix] = modulated_frequency;
            let carrier_source = unsafe { self.operators.get_unchecked_mut(operator_ix) };
            let sample = carrier_source.gen_sample(
                modulated_frequency,
                wavetables,
                param_buffers,
                sample_ix_within_frame,
            );
            if sample > 1.0 {
                panic!("TOO BIG");
            } else if sample < -1.0 {
                panic!("TOO SMALL");
            }
            samples_per_operator[operator_ix] = sample;
            output_sample += sample
                * modulation_matrix.get_output_weight(operator_ix).get(
                    param_buffers,
                    &self.adsrs,
                    sample_ix_within_frame,
                );
        }

        self.last_samples = samples_per_operator;
        self.last_sample_frequencies_per_operator = frequencies_per_operator;
        output_sample
    }
}

#[derive(Clone, Copy)]
pub enum ParamSource {
    /// Each sample, the value for this param is pulled out of the parameter buffer of this index.
    /// These buffers are populated externally every frame.
    ParamBuffer(usize),
    Constant(f32),
    /// The value of this parameter is determined by the output of a per-voice ADSR that is
    /// triggered every time that voice is triggered.
    PerVoiceADSR(usize),
}

#[derive(Clone, Copy)]
pub enum OperatorFrequencySource {
    ValueSource(ParamSource),
    BaseFrequencyMultiplier(f32),
}

impl OperatorFrequencySource {
    pub fn get(
        &self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix: usize,
        base_frequency: f32,
    ) -> f32 {
        match self {
            OperatorFrequencySource::ValueSource(src) => src.get(param_buffers, adsrs, sample_ix),
            OperatorFrequencySource::BaseFrequencyMultiplier(multiplier) =>
                base_frequency * *multiplier,
        }
    }

    pub fn from_parts(value_type: usize, value_param_int: usize, value_param_float: f32) -> Self {
        match value_type {
            0 => OperatorFrequencySource::ValueSource(ParamSource::ParamBuffer(value_param_int)),
            1 => OperatorFrequencySource::ValueSource(ParamSource::Constant(value_param_float)),
            2 => OperatorFrequencySource::ValueSource(ParamSource::PerVoiceADSR(value_param_int)),
            3 => OperatorFrequencySource::BaseFrequencyMultiplier(value_param_float),
            _ => panic!("Invalid value type; expected 0-3"),
        }
    }
}

impl Default for ParamSource {
    fn default() -> Self { ParamSource::Constant(0.0) }
}

impl ParamSource {
    pub fn get(
        &self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
    ) -> f32 {
        match self {
            ParamSource::ParamBuffer(buf_ix) => param_buffers[*buf_ix][sample_ix_within_frame],
            ParamSource::Constant(val) => *val,
            ParamSource::PerVoiceADSR(adsr_ix) => {
                let adsr = &adsrs[*adsr_ix];
                // TODO
                -1.
            },
        }
    }

    pub fn from_parts(value_type: usize, value_param_int: usize, value_param_float: f32) -> Self {
        match value_type {
            0 => ParamSource::ParamBuffer(value_param_int),
            1 => ParamSource::Constant(value_param_float),
            2 => ParamSource::PerVoiceADSR(value_param_int),
            _ => panic!("Invalid value type; expected 0-2"),
        }
    }
}

pub const OPERATOR_COUNT: usize = 8;
pub const FRAME_SIZE: usize = 128;
pub const SAMPLE_RATE: usize = 44_100;
pub const MAX_PARAM_BUFFERS: usize = 16;

/// Holds the weights that controls how much each operator modulates each of the other operators,
/// itself via feedback, and outputs
#[derive(Default)]
pub struct ModulationMatrix {
    pub weights_per_operator: [[ParamSource; OPERATOR_COUNT]; OPERATOR_COUNT],
    pub output_weights: [ParamSource; OPERATOR_COUNT],
}

impl ModulationMatrix {
    pub fn get_operator_modulation_index(
        &self,
        src_operator_ix: usize,
        dst_operator_ix: usize,
    ) -> &ParamSource {
        unsafe {
            self.weights_per_operator
                .get_unchecked(src_operator_ix)
                .get_unchecked(dst_operator_ix)
        }
    }

    pub fn get_output_weight(&self, operator_ix: usize) -> &ParamSource {
        unsafe { self.output_weights.get_unchecked(operator_ix) }
    }
}

pub struct FMSynthContext {
    pub voices: Vec<FMSynthVoice>,
    pub modulation_matrix: ModulationMatrix,
    pub param_buffers: [[f32; FRAME_SIZE]; MAX_PARAM_BUFFERS],
    pub operator_base_frequency_sources: [OperatorFrequencySource; OPERATOR_COUNT],
    pub base_frequency_input_buffer: Vec<[f32; FRAME_SIZE]>,
    pub output_buffers: Vec<[f32; FRAME_SIZE]>,
}

impl FMSynthContext {
    pub fn generate(&mut self) {
        for sample_ix in 0..FRAME_SIZE {
            for (voice_ix, voice) in self.voices.iter_mut().enumerate() {
                let sample = voice.gen_sample(
                    &self.modulation_matrix,
                    &mut [],
                    &self.param_buffers,
                    sample_ix,
                    &self.operator_base_frequency_sources,
                    unsafe {
                        *self
                            .base_frequency_input_buffer
                            .get_unchecked(voice_ix)
                            .get_unchecked(sample_ix)
                    },
                );
                unsafe {
                    *self
                        .output_buffers
                        .get_unchecked_mut(voice_ix)
                        .get_unchecked_mut(sample_ix) = sample
                };
            }
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn init_fm_synth_ctx(voice_count: usize) -> *mut FMSynthContext {
    Box::into_raw(box FMSynthContext {
        voices: vec![FMSynthVoice::default(); voice_count],
        modulation_matrix: ModulationMatrix::default(),
        param_buffers: [[0.0; FRAME_SIZE]; MAX_PARAM_BUFFERS],
        operator_base_frequency_sources: [OperatorFrequencySource::BaseFrequencyMultiplier(1.);
            OPERATOR_COUNT],
        base_frequency_input_buffer: vec![[0.; FRAME_SIZE]; voice_count],
        output_buffers: vec![[0.0; FRAME_SIZE]; voice_count],
    })
}

#[no_mangle]
pub unsafe extern "C" fn free_fm_synth_ctx(ctx: *mut FMSynthContext) { drop(Box::from_raw(ctx)) }

#[no_mangle]
pub unsafe extern "C" fn get_param_buffers_ptr(ctx: *mut FMSynthContext) -> *mut [f32; FRAME_SIZE] {
    (*ctx).param_buffers.as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn get_base_frequency_input_buffer_ptr(ctx: *mut FMSynthContext) -> *mut f32 {
    (*ctx).base_frequency_input_buffer.as_mut_ptr() as *mut _
}

#[no_mangle]
pub unsafe extern "C" fn fm_synth_generate(ctx: *mut FMSynthContext) -> *const [f32; FRAME_SIZE] {
    (*ctx).generate();
    (*ctx).output_buffers.as_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn fm_synth_set_modulation_index(
    ctx: *mut FMSynthContext,
    src_operator_ix: usize,
    dst_operator_ix: usize,
    value_type: usize,
    val_param_int: usize,
    val_param_float: f32,
) {
    let param = ParamSource::from_parts(value_type, val_param_int, val_param_float);
    (*ctx).modulation_matrix.weights_per_operator[src_operator_ix][dst_operator_ix] = param;
}

#[no_mangle]
pub unsafe extern "C" fn fm_synth_set_output_weight_value(
    ctx: *mut FMSynthContext,
    operator_ix: usize,
    value_type: usize,
    val_param_int: usize,
    val_param_float: f32,
) {
    let param = ParamSource::from_parts(value_type, val_param_int, val_param_float);
    (*ctx).modulation_matrix.output_weights[operator_ix] = param;
}

#[no_mangle]
pub unsafe extern "C" fn fm_synth_set_operator_base_frequency_source(
    ctx: *mut FMSynthContext,
    operator_ix: usize,
    value_type: usize,
    value_param_int: usize,
    value_param_float: f32,
) {
    let param = OperatorFrequencySource::from_parts(value_type, value_param_int, value_param_float);
    (*ctx).operator_base_frequency_sources[operator_ix] = param;
}
