pub struct WrappedWavetable {
    pub sample_ix: f32,
    pub mixes: ValueSource,
}

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
        self.phase = (self.phase + (1. / (SAMPLE_RATE as f32 / frequency))) % 1.;
        (self.phase * std::f32::consts::PI * 2.).sin()
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
        sample_ix: usize,
    ) -> f32 {
        match self {
            OscillatorSource::Wavetable(wavetable_ix) => {
                // TODO
                -1.0
            },
            OscillatorSource::ParamBuffer(buf_ix) => param_buffers[*buf_ix][sample_ix],
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
}

/// Applies modulation from all other operators to the provided frequency, returning the modulated
/// frequency
fn compute_modulated_frequency(
    modulation_matrix: &ModulationMatrix,
    last_samples: &[f32; OPERATOR_COUNT],
    param_buffers: &[[f32; FRAME_SIZE]],
    adsrs: &[ADSRState],
    operator_ix: usize,
    sample_ix: usize,
    frequency: f32,
) -> f32 {
    let mut output_freq = frequency;
    for i in 0..OPERATOR_COUNT {
        let op_output = last_samples[i];
        let op_multiplier = modulation_matrix.weights_per_operator[i][operator_ix].get(
            param_buffers,
            adsrs,
            sample_ix,
        );
        output_freq += op_output * op_multiplier;
    }
    dsp::clamp(0., 20_000., output_freq)
}

impl FMSynthVoice {
    pub fn gen_sample(
        &mut self,
        modulation_matrix: &ModulationMatrix,
        wavetables: &mut [()],
        param_buffers: &[[f32; FRAME_SIZE]],
        sample_ix: usize,
        input_frequency_buffers: &[[f32; FRAME_SIZE]; OPERATOR_COUNT],
    ) -> f32 {
        // TODO: Update ADSR state

        let mut samples_per_operator: [f32; OPERATOR_COUNT] = [0.0f32; OPERATOR_COUNT];
        let mut output_sample = 0.0f32;

        for operator_ix in 0..OPERATOR_COUNT {
            let base_frequency = input_frequency_buffers[operator_ix][sample_ix];
            let modulated_frequency = compute_modulated_frequency(
                modulation_matrix,
                &self.last_samples,
                param_buffers,
                &self.adsrs,
                operator_ix,
                sample_ix,
                base_frequency,
            );
            let operator_source = &mut self.operators[operator_ix];
            let sample = operator_source.gen_sample(
                modulated_frequency,
                wavetables,
                param_buffers,
                sample_ix,
            );
            samples_per_operator[operator_ix] = sample;
            output_sample += sample
                * modulation_matrix.output_weights[operator_ix].get(
                    param_buffers,
                    &self.adsrs,
                    sample_ix,
                );
        }

        self.last_samples = samples_per_operator;
        dsp::clamp(-1., 1., output_sample)
    }
}

pub enum ValueSource {
    /// Each sample, the value for this param is pulled out of the parameter buffer of this index.
    /// These buffers are populated externally every frame.
    ParamBuffer(usize),
    Constant(f32),
    /// The value of this parameter is determined by the output of a per-voice ADSR that is
    /// triggered every time that voice is triggered.
    PerVoiceADSR(usize),
}

impl Default for ValueSource {
    fn default() -> Self { ValueSource::Constant(0.0) }
}

impl ValueSource {
    pub fn get(
        &self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix: usize,
    ) -> f32 {
        match self {
            ValueSource::ParamBuffer(buf_ix) => param_buffers[*buf_ix][sample_ix],
            ValueSource::Constant(val) => *val,
            ValueSource::PerVoiceADSR(adsr_ix) => {
                let adsr = &adsrs[*adsr_ix];
                // TODO
                -1.
            },
        }
    }

    pub fn from_parts(value_type: usize, value_param_int: usize, value_param_float: f32) -> Self {
        match value_type {
            0 => ValueSource::ParamBuffer(value_param_int),
            1 => ValueSource::Constant(value_param_float),
            2 => ValueSource::PerVoiceADSR(value_param_int),
            _ => panic!("Invalid value type; expected 0-3"),
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
    pub weights_per_operator: [[ValueSource; OPERATOR_COUNT]; OPERATOR_COUNT],
    pub output_weights: [ValueSource; OPERATOR_COUNT],
}

pub struct FMSynthContext {
    pub voices: Vec<FMSynthVoice>,
    pub modulation_matrix: ModulationMatrix,
    pub param_buffers: [[f32; FRAME_SIZE]; MAX_PARAM_BUFFERS],
    pub input_frequency_buffers: [[f32; FRAME_SIZE]; OPERATOR_COUNT],
    pub output_buffers: [[f32; FRAME_SIZE]; OPERATOR_COUNT],
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
                    &self.input_frequency_buffers,
                );
                self.output_buffers[voice_ix][sample_ix] = sample;
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
        input_frequency_buffers: [[0.0; FRAME_SIZE]; OPERATOR_COUNT],
        output_buffers: [[0.0; FRAME_SIZE]; OPERATOR_COUNT],
    })
}

#[no_mangle]
pub unsafe extern "C" fn free_fm_synth_ctx(ctx: *mut FMSynthContext) { drop(Box::from_raw(ctx)) }

#[no_mangle]
pub unsafe extern "C" fn get_param_buffers_ptr(ctx: *mut FMSynthContext) -> *mut [f32; FRAME_SIZE] {
    (*ctx).param_buffers.as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn get_input_frequency_buffers_ptr(
    ctx: *mut FMSynthContext,
) -> *mut [f32; FRAME_SIZE] {
    (*ctx).input_frequency_buffers.as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn fm_synth_generate(ctx: *mut FMSynthContext) -> *const [f32; FRAME_SIZE] {
    (*ctx).generate();
    (*ctx).output_buffers.as_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn fm_synth_set_modulation_value(
    ctx: *mut FMSynthContext,
    src_operator_ix: usize,
    dst_operator_ix: usize,
    value_type: usize,
    val_param_int: usize,
    val_param_float: f32,
) {
    let param = ValueSource::from_parts(value_type, val_param_int, val_param_float);
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
    let param = ValueSource::from_parts(value_type, val_param_int, val_param_float);
    (*ctx).modulation_matrix.output_weights[operator_ix] = param;
}
