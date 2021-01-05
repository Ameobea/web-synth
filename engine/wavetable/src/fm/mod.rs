use core::arch::wasm32::*;
use std::hint::unreachable_unchecked;

use dsp::oscillator::PhasedOscillator;

pub mod effects;
use self::effects::{bitcrusher::even_faster_pow, Effect, EffectChain};

#[derive(Clone, Default)]
pub struct ADSRState {
    // TODO
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

/// Taken from `fastapprox::fast` but with some checks/extra work removed since we know things
/// statically that the compiler can't seem to figure out even with some coaxing
mod fast {
    use fastapprox::bits::{from_bits, to_bits};

    /// Base 2 logarithm.
    #[inline]
    pub fn log2(x: f32) -> f32 {
        let vx = to_bits(x);
        let mx = from_bits((vx & 0x007FFFFF_u32) | 0x3f000000);
        let mut y = vx as f32;
        y *= 1.1920928955078125e-7_f32;
        y - 124.22551499_f32 - 1.498030302_f32 * mx - 1.72587999_f32 / (0.3520887068_f32 + mx)
    }

    /// Raises 2 to a floating point power.  MUST NOT BE CALLED WITH NEGATIVE OR DENORMAL ARGUMENTS
    #[inline]
    pub fn pow2(p: f32) -> f32 {
        let w = p as i32;
        let z = p - (w as f32);
        let v = ((1 << 23) as f32
            * (p + 121.2740575_f32 + 27.7280233_f32 / (4.84252568_f32 - z) - 1.49012907_f32 * z))
            as u32;
        from_bits(v)
    }

    /// Raises a number to a floating point power.
    #[inline]
    pub fn pow(x: f32, p: f32) -> f32 { pow2(p * log2(x)) }
}

impl ExponentialOscillator {
    pub fn gen_sample(
        &mut self,
        frequency: f32,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
    ) -> f32 {
        self.update_phase(frequency);

        let stretch_factor = self
            .stretch_factor
            .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency)
            .abs()
            .min(1.);
        if stretch_factor < 0. {
            unsafe { unreachable_unchecked() }
        }

        // let exponent_numerator = 10.0f32.powf(4.0 * (stretch_factor * 0.8 + 0.35)) + 1.;
        let exponent_numerator = even_faster_pow(10.0f32, stretch_factor * 0.32 + 1.4) + 1.;
        let exponent_denominator = 999.0f32;
        let exponent = exponent_numerator / exponent_denominator;
        if exponent < 0. {
            unsafe { unreachable_unchecked() }
        }

        // Transform phase into [-1, 1] range
        let extended_phase = self.phase * 2. - 1.;
        let absolute_phase = extended_phase.abs();
        if absolute_phase < 0. {
            unsafe { unreachable_unchecked() }
        }
        // val is from 0 to 1
        let val = if cfg!(debug_assertions) {
            let val = absolute_phase.powf(exponent);
            debug_assert!(val >= -1.);
            debug_assert!(val <= 1.);
            val
        } else {
            dsp::clamp(-1., 1., self::fast::pow(absolute_phase, exponent))
        };

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
            base_frequency,
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
        base_frequency: f32,
    ) -> f32 {
        match self {
            OscillatorSource::Wavetable(_wavetable_ix) => {
                // TODO
                -1.0
            },
            OscillatorSource::ParamBuffer(buf_ix) =>
                if cfg!(debug_assertions) {
                    param_buffers[*buf_ix][sample_ix_within_frame]
                } else {
                    *unsafe {
                        param_buffers
                            .get_unchecked(*buf_ix)
                            .get_unchecked(sample_ix_within_frame)
                    }
                },
            OscillatorSource::Sine(osc) => osc.gen_sample(frequency),
            OscillatorSource::ExponentialOscillator(osc) => osc.gen_sample(
                frequency,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
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
    last_samples: &[f32; OPERATOR_COUNT],
    operator_ix: usize,
    sample_ix_within_frame: usize,
    carrier_base_frequency: f32,
    last_sample_modulator_frequencies: &[f32; OPERATOR_COUNT],
    modulation_indices: &[[[f32; FRAME_SIZE]; OPERATOR_COUNT]; OPERATOR_COUNT],
) -> f32 {
    let mut output_freq = carrier_base_frequency;
    for modulator_operator_ix in 0..OPERATOR_COUNT {
        let modulator_output = unsafe { last_samples.get_unchecked(modulator_operator_ix) };
        let modulation_index = unsafe {
            *modulation_indices
                .get_unchecked(modulator_operator_ix)
                .get_unchecked(operator_ix)
                .get_unchecked(sample_ix_within_frame)
        };

        output_freq += modulator_output
            * modulation_index
            * unsafe { *last_sample_modulator_frequencies.get_unchecked(modulator_operator_ix) };
        debug_assert!(output_freq == 0. || output_freq.is_normal());
    }
    output_freq
}

impl FMSynthVoice {
    pub fn gen_samples(
        &mut self,
        modulation_matrix: &mut ModulationMatrix,
        wavetables: &mut [()],
        param_buffers: &[[f32; FRAME_SIZE]],
        operator_base_frequency_sources: &[ParamSource; OPERATOR_COUNT],
        base_frequencies: &[f32; FRAME_SIZE],
        output_buffer: &mut [f32; FRAME_SIZE],
    ) {
        let mut samples_per_operator: [f32; OPERATOR_COUNT] = self.last_samples;
        let mut frequencies_per_operator: [f32; OPERATOR_COUNT] =
            self.last_sample_frequencies_per_operator;

        // Render all operator base frequencies for the full frame ahead of time using SIMD
        let mut operator_base_frequencies: [[f32; FRAME_SIZE]; OPERATOR_COUNT] =
            unsafe { std::mem::MaybeUninit::uninit().assume_init() };
        let render_params = RenderRawParams {
            param_buffers,
            adsrs: &self.adsrs,
            base_frequencies,
        };
        for operator_ix in 0..OPERATOR_COUNT {
            unsafe { *operator_base_frequency_sources.get_unchecked(operator_ix) }
                .render_raw(&render_params, unsafe {
                    operator_base_frequencies.get_unchecked_mut(operator_ix)
                });
        }

        // Render all modulation indices for the full frame ahread of time using SIMD
        // modulation_indices[src_operator_ix][dst_operator_ix][sample_ix_within_frame]
        let mut modulation_indices: [[[f32; FRAME_SIZE]; OPERATOR_COUNT]; OPERATOR_COUNT] =
            unsafe { std::mem::MaybeUninit::uninit().assume_init() };
        for src_operator_ix in 0..OPERATOR_COUNT {
            for dst_operator_ix in 0..OPERATOR_COUNT {
                let param = modulation_matrix
                    .get_operator_modulation_index(src_operator_ix, dst_operator_ix);
                // TODO: smoothing
                let buf = unsafe {
                    modulation_indices
                        .get_unchecked_mut(src_operator_ix)
                        .get_unchecked_mut(dst_operator_ix)
                };
                param.render_raw(&render_params, buf);
            }
        }

        for sample_ix_within_frame in 0..FRAME_SIZE {
            let mut output_sample = 0.0f32;

            let base_frequency = *unsafe { base_frequencies.get_unchecked(sample_ix_within_frame) };

            // TODO: Update ADSR state

            for operator_ix in 0..OPERATOR_COUNT {
                let carrier_base_frequency = unsafe {
                    *operator_base_frequencies
                        .get_unchecked(operator_ix)
                        .get_unchecked(sample_ix_within_frame)
                };
                let modulated_frequency = compute_modulated_frequency(
                    &samples_per_operator,
                    operator_ix,
                    sample_ix_within_frame,
                    carrier_base_frequency,
                    &frequencies_per_operator,
                    &modulation_indices,
                );
                *unsafe { frequencies_per_operator.get_unchecked_mut(operator_ix) } =
                    modulated_frequency;
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

                *unsafe { samples_per_operator.get_unchecked_mut(operator_ix) } = sample;
                output_sample += sample
                    * modulation_matrix.get_output_weight(operator_ix).get(
                        param_buffers,
                        &self.adsrs,
                        sample_ix_within_frame,
                        base_frequency,
                    );
            }

            debug_assert!(output_sample == 0. || output_sample.is_normal());
            unsafe {
                *output_buffer.get_unchecked_mut(sample_ix_within_frame) =
                    dsp::clamp(-10., 10., output_sample);
            }
        }

        self.last_samples = samples_per_operator;
        self.last_sample_frequencies_per_operator = frequencies_per_operator;

        self.effect_chain.apply_all(&render_params, output_buffer);
    }
}

#[derive(Clone, Copy)]
pub enum ParamSourceType {
    /// Each sample, the value for this param is pulled out of the parameter buffer of this index.
    /// These buffers are populated externally every frame.
    ParamBuffer(usize),
    Constant(f32),
    /// The value of this parameter is determined by the output of a per-voice ADSR that is
    /// triggered every time that voice is triggered.
    PerVoiceADSR(usize),
    BaseFrequencyMultiplier(f32),
}

#[derive(Clone, Copy)]
pub struct ParamSource {
    pub source_type: ParamSourceType,
    pub value: f32,
}

pub struct RenderRawParams<'a> {
    pub param_buffers: &'a [[f32; FRAME_SIZE]],
    pub adsrs: &'a [ADSRState],
    pub base_frequencies: &'a [f32; FRAME_SIZE],
}

impl ParamSource {
    pub fn new(source_type: ParamSourceType) -> Self {
        ParamSource {
            source_type,
            value: 0.,
        }
    }

    pub fn get_raw(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
    ) -> f32 {
        self.source_type
            .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency)
    }

    pub fn get(
        &mut self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
    ) -> f32 {
        let output =
            self.source_type
                .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);
        // Apply smoothing to avoid clicks/pops/other audio artifacts caused by jumping between
        // param values quickly
        dsp::one_pole(&mut self.value, output, 0.995)
    }

    pub fn render_raw<'a>(&self, params: &RenderRawParams<'a>, output_buf: &mut [f32; FRAME_SIZE]) {
        self.source_type.render_raw(params, output_buf);
    }

    /// Replaces the param generator while preserving the previous value used for smoothing
    pub fn replace(&mut self, new_source_type: ParamSourceType) {
        self.source_type = new_source_type;
    }
}

impl Default for ParamSource {
    fn default() -> Self { Self::new(ParamSourceType::Constant(0.0)) }
}

impl ParamSourceType {
    pub fn get(
        &self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[ADSRState],
        sample_ix_within_frame: usize,
        base_frequency: f32,
    ) -> f32 {
        match self {
            ParamSourceType::ParamBuffer(buf_ix) => {
                let raw = if cfg!(debug_assertions) {
                    param_buffers[*buf_ix][sample_ix_within_frame]
                } else {
                    unsafe {
                        *param_buffers
                            .get_unchecked(*buf_ix)
                            .get_unchecked(sample_ix_within_frame)
                    }
                };

                // if raw.is_normal() {
                //     raw
                // } else {
                //     0.
                // }
                raw
            },
            ParamSourceType::Constant(val) => *val,
            ParamSourceType::PerVoiceADSR(adsr_ix) => {
                let adsr = if cfg!(debug_assertions) {
                    &adsrs[*adsr_ix]
                } else {
                    unsafe { adsrs.get_unchecked(*adsr_ix) }
                };

                // TODO
                -1.
            },
            ParamSourceType::BaseFrequencyMultiplier(multiplier) => base_frequency * multiplier,
        }
    }

    pub fn from_parts(value_type: usize, value_param_int: usize, value_param_float: f32) -> Self {
        match value_type {
            0 => ParamSourceType::ParamBuffer(value_param_int),
            1 => ParamSourceType::Constant(value_param_float),
            2 => ParamSourceType::PerVoiceADSR(value_param_int),
            3 => ParamSourceType::BaseFrequencyMultiplier(value_param_float),
            _ => panic!("Invalid value type; expected 0-2"),
        }
    }

    pub fn render_raw<'a>(
        &self,
        RenderRawParams {
            param_buffers,
            adsrs,
            base_frequencies,
        }: &'a RenderRawParams<'a>,
        output_buf: &mut [f32; FRAME_SIZE],
    ) {
        match self {
            ParamSourceType::Constant(val) => unsafe {
                let splat = f32x4_splat(*val);
                let base_output_ptr = output_buf.as_ptr() as *mut v128;
                for i in 0..FRAME_SIZE / 4 {
                    v128_store(base_output_ptr.add(i), splat);
                }
            },
            ParamSourceType::ParamBuffer(buffer_ix) => {
                let param_buf = unsafe { param_buffers.get_unchecked(*buffer_ix) };
                let base_input_ptr = param_buf.as_ptr() as *const v128;
                let base_output_ptr = output_buf.as_ptr() as *mut v128;
                for i in 0..FRAME_SIZE / 4 {
                    unsafe {
                        let v = v128_load(base_input_ptr.add(i));
                        v128_store(base_output_ptr.add(i), v);
                    }
                }
            },
            ParamSourceType::BaseFrequencyMultiplier(multiplier) => {
                let base_input_ptr = base_frequencies.as_ptr() as *const v128;
                let base_output_ptr = output_buf.as_ptr() as *mut v128;
                let multiplier = unsafe { f32x4_splat(*multiplier) };

                for i in 0..FRAME_SIZE / 4 {
                    unsafe {
                        let v = v128_load(base_input_ptr.add(i));
                        let multiplied = f32x4_mul(v, multiplier);
                        v128_store(base_output_ptr.add(i), multiplied);
                    }
                }
            },
            ParamSourceType::PerVoiceADSR(_) => todo!(),
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
        &mut self,
        src_operator_ix: usize,
        dst_operator_ix: usize,
    ) -> &mut ParamSource {
        if cfg!(debug_assertions) {
            &mut self.weights_per_operator[src_operator_ix][dst_operator_ix]
        } else {
            unsafe {
                self.weights_per_operator
                    .get_unchecked_mut(src_operator_ix)
                    .get_unchecked_mut(dst_operator_ix)
            }
        }
    }

    pub fn get_output_weight(&mut self, operator_ix: usize) -> &mut ParamSource {
        if cfg!(debug_assertions) {
            &mut self.output_weights[operator_ix]
        } else {
            unsafe { self.output_weights.get_unchecked_mut(operator_ix) }
        }
    }
}

pub struct FMSynthContext {
    pub voices: Vec<FMSynthVoice>,
    pub modulation_matrix: ModulationMatrix,
    pub param_buffers: [[f32; FRAME_SIZE]; MAX_PARAM_BUFFERS],
    pub operator_base_frequency_sources: [ParamSource; OPERATOR_COUNT],
    pub base_frequency_input_buffer: Vec<[f32; FRAME_SIZE]>,
    pub output_buffers: Vec<[f32; FRAME_SIZE]>,
}

impl FMSynthContext {
    pub fn generate(&mut self) {
        for (voice_ix, voice) in self.voices.iter_mut().enumerate() {
            let base_frequency_buffer =
                unsafe { self.base_frequency_input_buffer.get_unchecked(voice_ix) };
            if unsafe { *base_frequency_buffer.get_unchecked(0) } == 0. {
                continue;
            }
            let output_buffer = unsafe { self.output_buffers.get_unchecked_mut(voice_ix) };

            voice.gen_samples(
                &mut self.modulation_matrix,
                &mut [],
                &self.param_buffers,
                &self.operator_base_frequency_sources,
                base_frequency_buffer,
                output_buffer,
            );
        }
    }
}

#[no_mangle]
#[cold]
pub unsafe extern "C" fn init_fm_synth_ctx(voice_count: usize) -> *mut FMSynthContext {
    crate::lookup_tables::maybe_init_lookup_tables();

    Box::into_raw(box FMSynthContext {
        voices: vec![FMSynthVoice::default(); voice_count],
        modulation_matrix: ModulationMatrix::default(),
        param_buffers: std::mem::MaybeUninit::uninit().assume_init(),
        operator_base_frequency_sources: [ParamSource::new(
            ParamSourceType::BaseFrequencyMultiplier(1.),
        ); OPERATOR_COUNT],
        base_frequency_input_buffer: vec![[0.; FRAME_SIZE]; voice_count],
        output_buffers: vec![std::mem::MaybeUninit::uninit().assume_init(); voice_count],
    })
}

// #[no_mangle]
// #[cold]
// pub unsafe extern "C" fn free_fm_synth_ctx(ctx: *mut FMSynthContext) { drop(Box::from_raw(ctx)) }

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
    let param = ParamSource::new(ParamSourceType::from_parts(
        value_type,
        val_param_int,
        val_param_float,
    ));
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
    let param = ParamSource::new(ParamSourceType::from_parts(
        value_type,
        val_param_int,
        val_param_float,
    ));
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
            stretch_factor: ParamSource::new(ParamSourceType::from_parts(
                param_value_type,
                param_val_int,
                param_val_float,
            )),
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
    let param = ParamSource::new(ParamSourceType::from_parts(
        value_type,
        value_param_int,
        value_param_float,
    ));
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
