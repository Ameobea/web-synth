pub mod effects;
use self::effects::{Effect, EffectChain};

#[derive(Clone, Default)]
pub struct ADSRState {
    // TODO
}

trait PhasedOscillator {
    fn get_phase(&self) -> f32;

    fn set_phase(&mut self, new_phase: f32);

    fn update_phase(&mut self, frequency: f32) {
        // 1 phase corresponds to 1 period of the waveform.  1 phase is passed every (SAMPLE_RATE /
        // frequency) samples.
        let phase = self.get_phase();
        // if frequency.is_normal() && frequency.abs() > 0.001 {
        let mut new_phase = (phase + (1. / (SAMPLE_RATE as f32 / frequency))).fract();
        if new_phase < 0. {
            new_phase = 1. + new_phase;
        }
        self.set_phase(new_phase);
        // }
    }
}

#[derive(Clone, Default)]
pub struct SineOscillator {
    pub phase: f32,
}

impl PhasedOscillator for SineOscillator {
    fn get_phase(&self) -> f32 { self.phase }

    fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl SineOscillator {
    pub fn gen_sample(&mut self, frequency: f32) -> f32 {
        self.update_phase(frequency);

        let sine_lookup_table = crate::lookup_tables::get_sine_lookup_table();
        dsp::read_interpolated(
            sine_lookup_table,
            self.phase * (sine_lookup_table.len() - 2) as f32,
        )
    }
}

#[derive(Clone)]
pub struct ExponentialOscillator {
    pub phase: f32,
    pub stretch_factor: ParamSource,
}

impl ExponentialOscillator {
    pub fn new(stretch_factor: ParamSource) -> Self {
        ExponentialOscillator {
            phase: 0.,
            stretch_factor,
        }
    }
}

impl PhasedOscillator for ExponentialOscillator {
    fn get_phase(&self) -> f32 { self.phase }

    fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl ExponentialOscillator {
    pub fn gen_sample(
        &mut self,
        frequency: f32,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
    ) -> f32 {
        self.update_phase(frequency);

        let stretch_factor = self
            .stretch_factor
            .get(param_buffers, adsrs, sample_ix_within_frame);

        // let exponent_numerator = 10.0f32.powf(4.0 * (stretch_factor * 0.8 + 0.35)) + 1.;
        let exponent_numerator =
            fastapprox::faster::pow(10.0f32, 4.0 * (stretch_factor * 0.8 + 0.35)) + 1.;
        let exponent_denominator = 999.0f32;
        let exponent = exponent_numerator / exponent_denominator;

        // Transform phase into [-1, 1] range
        let extended_phase = self.phase * 2. - 1.;
        let absolute_phase = extended_phase.abs();
        // val is from 0 to 1
        // let val = absolute_phase.powf(exponent);
        let val = fastapprox::fast::pow(absolute_phase, exponent);
        debug_assert!(val > -1.);
        debug_assert!(val < 1.);
        // Re-apply sign
        // output is from -1 to 1
        val * extended_phase.signum()
    }
}

#[derive(Clone, Default)]
pub struct Operator {
    pub oscillator_source: OscillatorSource,
    pub effect_chain: EffectChain,
}

impl Operator {
    pub fn gen_sample(
        &mut self,
        frequency: f32,
        wavetables: &mut [()],
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
    ) -> f32 {
        let sample = self.oscillator_source.gen_sample(
            frequency,
            wavetables,
            param_buffers,
            adsrs,
            sample_ix_within_frame,
        );

        self.effect_chain.apply(
            param_buffers,
            adsrs,
            sample_ix_within_frame,
            base_frequency,
            sample,
        )
    }
}

#[derive(Clone)]
pub enum OscillatorSource {
    Wavetable(usize),
    ParamBuffer(usize),
    Sine(SineOscillator),
    ExponentialOscillator(ExponentialOscillator),
}

impl OscillatorSource {
    /// Returns the current phase of the oscillator, if it has one.  Used to preserve phase in cases
    /// where we're switching oscillator type.
    pub fn get_phase(&self) -> Option<f32> {
        match self {
            OscillatorSource::Wavetable(_) => todo!(),
            OscillatorSource::ParamBuffer(_) => None,
            OscillatorSource::Sine(osc) => Some(osc.get_phase()),
            OscillatorSource::ExponentialOscillator(osc) => Some(osc.get_phase()),
        }
    }
}

impl Default for OscillatorSource {
    fn default() -> Self { OscillatorSource::Sine(SineOscillator::default()) }
}

impl OscillatorSource {
    pub fn gen_sample(
        &mut self,
        frequency: f32,
        _wavetables: &mut [()],
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
    ) -> f32 {
        match self {
            OscillatorSource::Wavetable(_wavetable_ix) => {
                // TODO
                -1.0
            },
            OscillatorSource::ParamBuffer(buf_ix) => param_buffers[*buf_ix][sample_ix_within_frame],
            OscillatorSource::Sine(osc) => osc.gen_sample(frequency),
            OscillatorSource::ExponentialOscillator(osc) =>
                osc.gen_sample(frequency, param_buffers, adsrs, sample_ix_within_frame),
        }
    }
}

#[derive(Clone, Default)]
pub struct FMSynthVoice {
    pub output: f32,
    pub adsrs: Vec<ADSRState>,
    pub operators: [Operator; OPERATOR_COUNT],
    pub last_samples: [f32; OPERATOR_COUNT],
    pub last_sample_frequencies_per_operator: [f32; OPERATOR_COUNT],
    pub effect_chain: EffectChain,
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
            let carrier_operator = unsafe { self.operators.get_unchecked_mut(operator_ix) };
            let sample = carrier_operator.gen_sample(
                modulated_frequency,
                wavetables,
                param_buffers,
                &self.adsrs,
                sample_ix_within_frame,
                base_frequency,
            );
            debug_assert!(sample >= -1.);
            debug_assert!(sample <= 1.);

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

        self.effect_chain.apply(
            param_buffers,
            &self.adsrs,
            sample_ix_within_frame,
            base_frequency,
            output_sample,
        )
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
    crate::lookup_tables::maybe_init_lookup_tables();

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

fn build_oscillator_source(
    operator_type: usize,
    param_value_type: usize,
    param_val_int: usize,
    param_val_float: f32,
    phase_opt: Option<f32>,
) -> OscillatorSource {
    match operator_type {
        0 => OscillatorSource::Wavetable(param_val_int),
        1 => OscillatorSource::ParamBuffer(param_val_int),
        2 => OscillatorSource::Sine(SineOscillator {
            phase: phase_opt.unwrap_or_default(),
        }),
        3 => OscillatorSource::ExponentialOscillator(ExponentialOscillator {
            phase: phase_opt.unwrap_or_default(),
            stretch_factor: ParamSource::from_parts(
                param_value_type,
                param_val_int,
                param_val_float,
            ),
        }),
        _ => panic!("Invalid operator type: {}", operator_type),
    }
}

#[no_mangle]
pub unsafe extern "C" fn fm_synth_set_operator_config(
    ctx: *mut FMSynthContext,
    operator_ix: usize,
    operator_type: usize,
    param_value_type: usize,
    param_val_int: usize,
    param_val_float: f32,
) {
    for voice in &mut (*ctx).voices {
        let old_phase = voice.operators[operator_ix].oscillator_source.get_phase();
        voice.operators[operator_ix].oscillator_source = build_oscillator_source(
            operator_type,
            param_value_type,
            param_val_int,
            param_val_float,
            old_phase,
        );
    }
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

#[no_mangle]
pub unsafe extern "C" fn fm_synth_set_effect(
    ctx: *mut FMSynthContext,
    operator_ix: isize,
    effect_ix: usize,
    effect_type: isize,
    param_1_type: usize,
    param_1_int_val: usize,
    param_1_float_val: f32,
    param_2_type: usize,
    param_2_int_val: usize,
    param_2_float_val: f32,
    param_3_type: usize,
    param_3_int_val: usize,
    param_3_float_val: f32,
    param_4_type: usize,
    param_4_int_val: usize,
    param_4_float_val: f32,
) {
    for voice in &mut (*ctx).voices {
        let effect_chain = if operator_ix == -1 {
            &mut voice.effect_chain
        } else {
            &mut voice.operators[operator_ix as usize].effect_chain
        };

        if effect_type == -1 {
            effect_chain.remove_effect(effect_ix);
        } else {
            effect_chain.set_effect(
                effect_ix,
                effect_type as usize,
                param_1_type,
                param_1_int_val,
                param_1_float_val,
                param_2_type,
                param_2_int_val,
                param_2_float_val,
                param_3_type,
                param_3_int_val,
                param_3_float_val,
                param_4_type,
                param_4_int_val,
                param_4_float_val,
            );
        }
    }
}
