#[cfg(feature = "simd")]
use core::arch::wasm32::*;
use rand::Rng;
use std::rc::Rc;

use adsr::{
    Adsr, AdsrStep, EarlyReleaseConfig, EarlyReleaseStrategy, GateStatus, RampFn,
    RENDERED_BUFFER_SIZE,
};
use dsp::{even_faster_pow, oscillator::PhasedOscillator};

pub mod effects;
mod samples;
use crate::{WaveTable, WaveTableSettings};

use self::{
    effects::EffectChain,
    samples::{
        init_sample_manager, sample_manager, SampleMappingEmitter, SampleMappingManager,
        SampleMappingOperatorConfig, TunedSampleEmitter,
    },
};

extern "C" {
    fn log_err(ptr: *const u8, len: usize);
}

pub static mut MIDI_CONTROL_VALUES: [f32; 1024] = [0.; 1024];
const GAIN_ENVELOPE_PHASE_BUF_INDEX: usize = 255;

#[no_mangle]
pub unsafe extern "C" fn fm_synth_set_midi_control_value(index: usize, value: usize) {
    if index >= MIDI_CONTROL_VALUES.len() || value > 127 {
        panic!();
    }

    MIDI_CONTROL_VALUES[index] = (value as f32) / 127.;
}

#[derive(Clone, Default, PartialEq)]
pub struct AdsrState {
    pub adsr_ix: usize,
    pub scale: f32,
    pub shift: f32,
}

pub trait Oscillator {
    fn gen_sample(
        &mut self,
        frequency: f32,
        wavetables: &[WaveTable],
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[Adsr],
        sample_ix_within_frame: usize,
        base_frequency: f32,
    ) -> f32;
}

#[derive(Clone, Default)]
pub struct SineOscillator {
    pub phase: f32,
}

impl PhasedOscillator for SineOscillator {
    fn get_phase(&self) -> f32 { self.phase }

    fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl Oscillator for SineOscillator {
    fn gen_sample(
        &mut self,
        frequency: f32,
        _wavetables: &[WaveTable],
        _param_buffers: &[[f32; FRAME_SIZE]],
        _adsrs: &[Adsr],
        _sample_ix_within_frame: usize,
        _base_frequency: f32,
    ) -> f32 {
        let sine_lookup_table = crate::lookup_tables::get_sine_lookup_table();
        if frequency.abs() < 1000. {
            self.update_phase(frequency);
            return dsp::read_interpolated(
                sine_lookup_table,
                self.phase * (sine_lookup_table.len() - 2) as f32,
            );
        }

        // 2x oversampling to avoid aliasing
        let mut out = 0.;
        let oversample_ratio = 2usize;
        for _ in 0..oversample_ratio {
            self.update_phase_oversampled(oversample_ratio as f32, frequency);
            out += dsp::read_interpolated(
                sine_lookup_table,
                self.phase * (sine_lookup_table.len() - 2) as f32,
            ) * (1. / (oversample_ratio as f32));
        }

        out
    }
}

#[derive(Clone)]
pub struct SquareOscillator {
    pub phase: f32,
}

impl PhasedOscillator for SquareOscillator {
    fn get_phase(&self) -> f32 { self.phase }

    fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl Oscillator for SquareOscillator {
    fn gen_sample(
        &mut self,
        frequency: f32,
        _wavetables: &[WaveTable],
        _param_buffers: &[[f32; FRAME_SIZE]],
        _adsrs: &[Adsr],
        _sample_ix_within_frame: usize,
        _base_frequency: f32,
    ) -> f32 {
        if frequency.abs() < 1000. {
            self.update_phase(frequency);
            return if self.phase < 0.5 { 1. } else { -1. };
        }

        // 4x oversampling to avoid aliasing
        let mut out = 0.;
        self.update_phase_oversampled(4., frequency);
        out += if self.phase < 0.5 { 0.25 } else { -0.25 };
        self.update_phase_oversampled(4., frequency);
        out += if self.phase < 0.5 { 0.25 } else { -0.25 };
        self.update_phase_oversampled(4., frequency);
        out += if self.phase < 0.5 { 0.25 } else { -0.25 };
        self.update_phase_oversampled(4., frequency);
        out += if self.phase < 0.5 { 0.25 } else { -0.25 };

        out
    }
}

#[derive(Clone, Default)]
pub struct TriangleOscillator {
    pub phase: f32,
}

impl PhasedOscillator for TriangleOscillator {
    fn get_phase(&self) -> f32 { self.phase }

    fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl Oscillator for TriangleOscillator {
    fn gen_sample(
        &mut self,
        frequency: f32,
        _wavetables: &[WaveTable],
        _param_buffers: &[[f32; FRAME_SIZE]],
        _adsrs: &[Adsr],
        _sample_ix_within_frame: usize,
        _base_frequency: f32,
    ) -> f32 {
        self.update_phase(frequency);

        let triangle_lookup_table = crate::lookup_tables::get_triangle_lookup_table();
        dsp::read_interpolated(
            triangle_lookup_table,
            self.phase * (triangle_lookup_table.len() - 2) as f32,
        )
    }
}

#[derive(Clone, Default)]
pub struct SawtoothOscillator {
    pub phase: f32,
}

impl PhasedOscillator for SawtoothOscillator {
    fn get_phase(&self) -> f32 { self.phase }

    fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

impl Oscillator for SawtoothOscillator {
    fn gen_sample(
        &mut self,
        frequency: f32,
        _wavetables: &[WaveTable],
        _param_buffers: &[[f32; FRAME_SIZE]],
        _adsrs: &[Adsr],
        _sample_ix_within_frame: usize,
        _base_frequency: f32,
    ) -> f32 {
        let sawtooth_lookup_table = crate::lookup_tables::get_sawtooth_lookup_table();
        if frequency.abs() < 1000. {
            self.update_phase(frequency);
            return dsp::read_interpolated(
                sawtooth_lookup_table,
                self.phase * (sawtooth_lookup_table.len() - 2) as f32,
            );
        }

        // 4x oversampling to avoid aliasing
        let mut out = 0.;
        for _ in 0..4 {
            self.update_phase_oversampled(4., frequency);
            out += dsp::read_interpolated(
                sawtooth_lookup_table,
                self.phase * (sawtooth_lookup_table.len() - 2) as f32,
            ) * 0.25;
        }

        out
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

#[derive(Clone)]
pub struct UnisonOscillator<T> {
    pub oscillators: Vec<T>,
    pub unison_detune_range_semitones: ParamSource,
}

impl<T: PhasedOscillator> UnisonOscillator<T> {
    pub fn set_phases(&mut self, new_phases: &[f32]) {
        for (i, osc) in self.oscillators.iter_mut().enumerate() {
            osc.set_phase(new_phases.get(i).copied().unwrap_or_default());
        }
    }

    pub fn set_phase_at(&mut self, new_phase: f32, ix: usize) {
        self.oscillators[ix].set_phase(new_phase);
    }

    pub fn get_phases(&self) -> Vec<f32> {
        let mut phases = Vec::with_capacity(self.oscillators.len());
        for i in 0..self.oscillators.len() {
            phases.push(self.oscillators[i].get_phase());
        }
        phases
    }
}

impl<T: Oscillator + PhasedOscillator> UnisonOscillator<T> {
    fn gen_sample(
        &mut self,
        frequency: f32,
        wavetables: &[WaveTable],
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[Adsr],
        sample_ix_within_frame: usize,
        base_frequency: f32,
    ) -> f32 {
        let mut out = 0.;
        let unison_detune_range_semitones = dsp::clamp(
            0.,
            1200.,
            self.unison_detune_range_semitones
                .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency)
                .abs(),
        );
        let unison_detune_semitones_start = -unison_detune_range_semitones / 2.;
        let unison_detune_step_semitones =
            unison_detune_range_semitones / (self.oscillators.len() - 1) as f32;

        // TODO: This may need to be optimized
        let middle_oscillator_ix = (self.oscillators.len() - 1) as f32 / 2.;
        let middle_count = if self.oscillators.len() % 2 == 0 {
            2
        } else {
            1
        };
        let outer_count = self.oscillators.len() - middle_count;
        let total_middle_gain_pct = if self.oscillators.len() == 2 { 1. } else { 0.2 }; // TODO: Make configurable
        let middle_gain_pct = total_middle_gain_pct / middle_count as f32;
        let total_outer_gain_pct = 1. - total_middle_gain_pct;
        let outer_gain_pct = if outer_count > 0 {
            total_outer_gain_pct / outer_count as f32
        } else {
            0.
        };

        for (i, osc) in self.oscillators.iter_mut().enumerate() {
            let frequency = compute_detune(
                frequency,
                unison_detune_semitones_start + i as f32 * unison_detune_step_semitones,
            );
            let is_middle = ((i as f32) - middle_oscillator_ix).abs() < 1.;
            let gain = if is_middle {
                middle_gain_pct
            } else {
                outer_gain_pct
            };
            out += osc.gen_sample(
                frequency,
                wavetables,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ) * gain;
        }
        out
    }
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
    #[inline(never)]
    fn gen_sample_with_stretch_factor(&mut self, frequency: f32, stretch_factor: f32) -> f32 {
        self.update_phase(frequency);
        let stretch_factor = dsp::clamp(0., 1., stretch_factor);

        // let exponent_numerator = 10.0f32.powf(4.0 * (stretch_factor * 0.8 + 0.35)) + 1.;
        let exponent_numerator = even_faster_pow(10.0f32, 4.0 * (stretch_factor * 0.8 + 0.35)) + 1.;
        let exponent_denominator = 999.0f32;
        let exponent = exponent_numerator / exponent_denominator;

        // Transform phase into [-1, 1] range
        let extended_phase = self.phase * 2. - 1.;
        let absolute_phase = extended_phase.abs();
        debug_assert!(absolute_phase >= 0.);
        debug_assert!(absolute_phase <= 1.);

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

    pub fn gen_sample(
        &mut self,
        frequency: f32,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[Adsr],
        sample_ix_within_frame: usize,
        base_frequency: f32,
    ) -> f32 {
        self.update_phase(frequency);

        let stretch_factor =
            self.stretch_factor
                .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency);

        self.gen_sample_with_stretch_factor(frequency, stretch_factor)
    }
}

#[derive(Clone)]
pub struct WaveTableHandle {
    wavetable_index: usize,
    phase: f32,
    dim_0_intra_mix: ParamSource,
    dim_1_intra_mix: ParamSource,
    inter_dim_mix: ParamSource,
}

impl Oscillator for WaveTableHandle {
    fn gen_sample(
        &mut self,
        frequency: f32,
        wavetables: &[WaveTable],
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[Adsr],
        sample_ix_within_frame: usize,
        base_frequency: f32,
    ) -> f32 {
        let wavetable = match wavetables.get(self.wavetable_index) {
            Some(wavetable) => wavetable,
            None => return 0.,
        };

        // dim_0_intra, unused, dim_1_intra, inter
        let mixes: [f32; 4] = [
            self.dim_0_intra_mix
                .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency),
            unsafe { std::mem::MaybeUninit::uninit().assume_init() },
            self.dim_1_intra_mix
                .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency),
            self.inter_dim_mix
                .get(param_buffers, adsrs, sample_ix_within_frame, base_frequency),
        ];

        // 4x oversampling to avoid aliasing
        let mut sample = 0.;
        for _ in 0..4 {
            self.update_phase_oversampled(4., frequency);
            sample += wavetable.get_sample(
                self.phase * wavetable.settings.waveform_length as f32,
                &mixes,
            );
        }
        sample * 0.25
    }
}

impl PhasedOscillator for WaveTableHandle {
    fn get_phase(&self) -> f32 { self.phase }

    fn set_phase(&mut self, new_phase: f32) { self.phase = new_phase; }
}

#[inline(always)]
fn uninit<T>() -> T { unsafe { std::mem::MaybeUninit::uninit().assume_init() } }

#[derive(Clone, Default)]
pub struct Operator {
    pub oscillator_source: OscillatorSource,
    pub effect_chain: EffectChain,
    pub enabled: bool,
    pub randomize_start_phases: bool,
}

impl Operator {
    pub fn gen_sample(
        &mut self,
        frequency: f32,
        wavetables: &[WaveTable],
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[Adsr],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample_mapping_config: &SampleMappingOperatorConfig,
    ) -> f32 {
        if !self.enabled {
            return 0.;
        }

        let sample = self.oscillator_source.gen_sample(
            frequency,
            wavetables,
            param_buffers,
            adsrs,
            sample_ix_within_frame,
            base_frequency,
            sample_mapping_config,
        );

        self.effect_chain
            .apply(sample_ix_within_frame, base_frequency, sample)
    }
}

#[derive(Clone)]
pub enum OscillatorSource {
    Sine(SineOscillator),
    Wavetable(WaveTableHandle),
    ParamBuffer(usize),
    ExponentialOscillator(ExponentialOscillator),
    Square(SquareOscillator),
    Triangle(TriangleOscillator),
    Sawtooth(SawtoothOscillator),
    UnisonSine(UnisonOscillator<SineOscillator>),
    UnisonWavetable(UnisonOscillator<WaveTableHandle>),
    UnisonSquare(UnisonOscillator<SquareOscillator>),
    UnisonTriangle(UnisonOscillator<TriangleOscillator>),
    UnisonSawtooth(UnisonOscillator<SawtoothOscillator>),
    SampleMapping(SampleMappingEmitter),
    TunedSample(TunedSampleEmitter),
}

impl OscillatorSource {
    /// Returns the current phase of the oscillator, if it has one.  Used to preserve phase in cases
    /// where we're switching oscillator type.
    pub fn get_phase(&self) -> Vec<f32> {
        match self {
            OscillatorSource::Wavetable(handle) => vec![handle.phase],
            OscillatorSource::ParamBuffer(_) => Vec::new(),
            OscillatorSource::Sine(osc) => vec![osc.get_phase()],
            OscillatorSource::ExponentialOscillator(osc) => vec![osc.get_phase()],
            OscillatorSource::Square(osc) => vec![osc.get_phase()],
            OscillatorSource::Triangle(osc) => vec![osc.get_phase()],
            OscillatorSource::Sawtooth(osc) => vec![osc.get_phase()],
            OscillatorSource::UnisonSine(osc) => osc.get_phases(),
            OscillatorSource::UnisonWavetable(osc) => osc.get_phases(),
            OscillatorSource::UnisonSquare(osc) => osc.get_phases(),
            OscillatorSource::UnisonTriangle(osc) => osc.get_phases(),
            OscillatorSource::UnisonSawtooth(osc) => osc.get_phases(),
            OscillatorSource::SampleMapping(_) => Vec::new(),
            OscillatorSource::TunedSample(_) => Vec::new(),
        }
    }

    pub fn set_phase(&mut self, new_phases: &[f32]) {
        let new_phase = new_phases.get(0).copied().unwrap_or_default();
        match self {
            OscillatorSource::Wavetable(handle) => handle.phase = new_phase,
            OscillatorSource::ParamBuffer(_) => (),
            OscillatorSource::Sine(osc) => osc.set_phase(new_phase),
            OscillatorSource::ExponentialOscillator(osc) => osc.set_phase(new_phase),
            OscillatorSource::Square(osc) => osc.set_phase(new_phase),
            OscillatorSource::Triangle(osc) => osc.set_phase(new_phase),
            OscillatorSource::Sawtooth(osc) => osc.set_phase(new_phase),
            OscillatorSource::UnisonSine(osc) => osc.set_phases(new_phases),
            OscillatorSource::UnisonWavetable(osc) => osc.set_phases(new_phases),
            OscillatorSource::UnisonSquare(osc) => osc.set_phases(new_phases),
            OscillatorSource::UnisonTriangle(osc) => osc.set_phases(new_phases),
            OscillatorSource::UnisonSawtooth(osc) => osc.set_phases(new_phases),
            OscillatorSource::SampleMapping(_) => (),
            OscillatorSource::TunedSample(_) => (),
        }
    }

    pub fn get_oscillator_count(&self) -> usize {
        match self {
            OscillatorSource::Wavetable(_) => 1,
            OscillatorSource::ParamBuffer(_) => 1,
            OscillatorSource::Sine(_) => 1,
            OscillatorSource::ExponentialOscillator(_) => 1,
            OscillatorSource::Square(_) => 1,
            OscillatorSource::Triangle(_) => 1,
            OscillatorSource::Sawtooth(_) => 1,
            OscillatorSource::UnisonSine(osc) => osc.oscillators.len(),
            OscillatorSource::UnisonWavetable(osc) => osc.oscillators.len(),
            OscillatorSource::UnisonSquare(osc) => osc.oscillators.len(),
            OscillatorSource::UnisonTriangle(osc) => osc.oscillators.len(),
            OscillatorSource::UnisonSawtooth(osc) => osc.oscillators.len(),
            OscillatorSource::SampleMapping(_) => 1,
            OscillatorSource::TunedSample(_) => 1,
        }
    }

    pub fn set_phase_at(&mut self, new_phase: f32, ix: usize) {
        match self {
            OscillatorSource::Wavetable(_) => (),
            OscillatorSource::ParamBuffer(_) => (),
            OscillatorSource::Sine(osc) => osc.set_phase(new_phase),
            OscillatorSource::ExponentialOscillator(osc) => osc.set_phase(new_phase),
            OscillatorSource::Square(osc) => osc.set_phase(new_phase),
            OscillatorSource::Triangle(osc) => osc.set_phase(new_phase),
            OscillatorSource::Sawtooth(osc) => osc.set_phase(new_phase),
            OscillatorSource::UnisonSine(osc) => osc.set_phase_at(new_phase, ix),
            OscillatorSource::UnisonWavetable(osc) => osc.set_phase_at(new_phase, ix),
            OscillatorSource::UnisonSquare(osc) => osc.set_phase_at(new_phase, ix),
            OscillatorSource::UnisonTriangle(osc) => osc.set_phase_at(new_phase, ix),
            OscillatorSource::UnisonSawtooth(osc) => osc.set_phase_at(new_phase, ix),
            OscillatorSource::SampleMapping(_) => (),
            OscillatorSource::TunedSample(_) => (),
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
        wavetables: &[WaveTable],
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[Adsr],
        sample_ix_within_frame: usize,
        base_frequency: f32,
        sample_mapping_config: &SampleMappingOperatorConfig,
    ) -> f32 {
        match self {
            OscillatorSource::Wavetable(handle) => handle.gen_sample(
                frequency,
                wavetables,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
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
            OscillatorSource::Sine(osc) => osc.gen_sample(
                frequency,
                wavetables,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
            OscillatorSource::ExponentialOscillator(osc) => osc.gen_sample(
                frequency,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
            OscillatorSource::Square(osc) => osc.gen_sample(
                frequency,
                wavetables,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
            OscillatorSource::Triangle(osc) => osc.gen_sample(
                frequency,
                wavetables,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
            OscillatorSource::Sawtooth(osc) => osc.gen_sample(
                frequency,
                wavetables,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
            OscillatorSource::UnisonSine(osc) => osc.gen_sample(
                frequency,
                wavetables,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
            OscillatorSource::UnisonWavetable(osc) => osc.gen_sample(
                frequency,
                wavetables,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
            OscillatorSource::UnisonSquare(osc) => osc.gen_sample(
                frequency,
                wavetables,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
            OscillatorSource::UnisonTriangle(osc) => osc.gen_sample(
                frequency,
                wavetables,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
            OscillatorSource::UnisonSawtooth(osc) => osc.gen_sample(
                frequency,
                wavetables,
                param_buffers,
                adsrs,
                sample_ix_within_frame,
                base_frequency,
            ),
            OscillatorSource::SampleMapping(emitter) =>
                emitter.gen_sample(base_frequency, sample_mapping_config),
            OscillatorSource::TunedSample(_) => todo!(),
        }
    }
}

#[derive(Clone)]
pub struct AdsrParams {
    len_samples: ParamSource,
}

#[derive(Clone)]
pub struct FMSynthVoice {
    pub output: f32,
    pub adsrs: Vec<Adsr>,
    pub adsr_params: Vec<AdsrParams>,
    pub operators: [Operator; OPERATOR_COUNT],
    pub last_samples: [f32; OPERATOR_COUNT],
    pub last_sample_frequencies_per_operator: [f32; OPERATOR_COUNT],
    pub effect_chain: EffectChain,
    cached_modulation_indices: [[[f32; FRAME_SIZE]; OPERATOR_COUNT]; OPERATOR_COUNT],
    pub gain_envelope: Adsr,
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

/// Based off of WebAudio's detune:
/// https://www.w3.org/TR/webaudio/#computedfrequency
///
/// computedFrequency(t) = frequency(t) * pow(2, detune(t) / 1200)
fn compute_detune(freq: f32, detune_semitones: f32) -> f32 {
    freq * fastapprox::fast::pow2(detune_semitones / 1200.)
}

fn build_default_gain_adsr_steps() -> Vec<AdsrStep> {
    vec![
        AdsrStep {
            x: 0.,
            y: 1.,
            ramper: RampFn::Linear,
        },
        AdsrStep {
            x: 1.,
            y: 1.,
            ramper: RampFn::Linear,
        },
    ]
}

impl FMSynthVoice {
    #[cold]
    fn new(shared_gain_adsr_rendered_buffer: Rc<[f32; RENDERED_BUFFER_SIZE]>) -> Self {
        FMSynthVoice {
            output: 0.,
            adsrs: Vec::new(),
            adsr_params: Vec::new(),
            operators: [
                Operator::default(),
                Operator::default(),
                Operator::default(),
                Operator::default(),
                Operator::default(),
                Operator::default(),
                Operator::default(),
                Operator::default(),
            ],
            last_samples: [0.0; OPERATOR_COUNT],
            last_sample_frequencies_per_operator: [0.0; OPERATOR_COUNT],
            effect_chain: EffectChain::default(),
            cached_modulation_indices: [[[0.0; FRAME_SIZE]; OPERATOR_COUNT]; OPERATOR_COUNT],
            gain_envelope: Adsr::new(
                build_default_gain_adsr_steps(),
                None,
                44_100.,
                0.975,
                shared_gain_adsr_rendered_buffer,
                EarlyReleaseConfig {
                    strategy: EarlyReleaseStrategy::LinearMix,
                    len_samples: 3_400,
                },
                false,
            ),
        }
    }

    pub fn gen_samples(
        &mut self,
        modulation_matrix: &mut ModulationMatrix,
        wavetables: &[WaveTable],
        param_buffers: &[[f32; FRAME_SIZE]],
        operator_base_frequency_sources: &[ParamSource; OPERATOR_COUNT],
        raw_base_frequencies: &[f32; FRAME_SIZE],
        output_buffer: &mut [f32; FRAME_SIZE],
        detune: Option<&ParamSource>,
        sample_mapping_manager: &SampleMappingManager,
    ) {
        let mut samples_per_operator_bufs: [[f32; OPERATOR_COUNT]; 2] =
            [self.last_samples, uninit()];
        let mut last_samples_per_operator: &mut [f32; OPERATOR_COUNT] =
            unsafe { &mut *samples_per_operator_bufs.as_mut_ptr().add(0) };
        let mut samples_per_operator: &mut [f32; OPERATOR_COUNT] =
            unsafe { &mut *samples_per_operator_bufs.as_mut_ptr().add(1) };

        let mut frequencies_per_operator_bufs: [[f32; OPERATOR_COUNT]; 2] =
            [self.last_sample_frequencies_per_operator, uninit()];
        let mut last_frequencies_per_operator: &mut [f32; OPERATOR_COUNT] =
            unsafe { &mut *frequencies_per_operator_bufs.as_mut_ptr().add(0) };
        let mut frequencies_per_operator: &mut [f32; OPERATOR_COUNT] =
            unsafe { &mut *frequencies_per_operator_bufs.as_mut_ptr().add(1) };

        // Update and pre-render all ADSRs
        for (adsr_ix, adsr) in self.adsrs.iter_mut().enumerate() {
            // Compute derived length for the ADSR for this frame and set it in.  We only support
            // k-rate ADSR length params for now; I don't think it will be a problem
            let len_samples = self.adsr_params[adsr_ix]
                .len_samples
                // Cannot use ADSR or base frequency as param sources for ADSR length
                .get(param_buffers, &[], 0, 0.);
            adsr.set_len_samples(len_samples);
            adsr.render_frame(1., 0.);
        }

        // If necessary, compute detuned base frequency based off of detune param
        let mut detuned_base_frequencies: [f32; FRAME_SIZE] = uninit();
        let base_frequencies = match detune {
            Some(detune) => {
                let mut detune_outputs: [f32; FRAME_SIZE] = uninit();
                detune.render_raw(
                    &RenderRawParams {
                        param_buffers,
                        adsrs: &self.adsrs,
                        base_frequencies: raw_base_frequencies,
                    },
                    &mut detune_outputs,
                );

                for i in 0..FRAME_SIZE {
                    unsafe {
                        let freq = *raw_base_frequencies.get_unchecked(i);
                        let detune = *detune_outputs.get_unchecked(i);
                        *detuned_base_frequencies.get_unchecked_mut(i) =
                            compute_detune(freq, detune);
                    }
                }

                &detuned_base_frequencies
            },
            None => raw_base_frequencies,
        };

        // Render all output weights for the full frame
        let mut rendered_output_weights: [[f32; FRAME_SIZE]; OPERATOR_COUNT] = uninit();

        // Render all operator base frequencies for the full frame ahead of time using SIMD
        let mut operator_base_frequencies: [[f32; FRAME_SIZE]; OPERATOR_COUNT] = uninit();

        let render_params = RenderRawParams {
            param_buffers,
            adsrs: &self.adsrs,
            base_frequencies,
        };

        for operator_ix in 0..OPERATOR_COUNT {
            let operator = unsafe { self.operators.get_unchecked_mut(operator_ix) };
            if !operator.enabled {
                last_samples_per_operator[operator_ix] = 0.;
                last_frequencies_per_operator[operator_ix] = 0.;
                continue;
            }

            unsafe { operator_base_frequency_sources.get_unchecked(operator_ix) }
                .render_raw(&render_params, unsafe {
                    operator_base_frequencies.get_unchecked_mut(operator_ix)
                });

            modulation_matrix
                .get_output_weight(operator_ix)
                .render_raw(&render_params, unsafe {
                    rendered_output_weights.get_unchecked_mut(operator_ix)
                });

            // Render the params for all per-operator-per-voice effects ahead of time as well
            operator.effect_chain.pre_render_params(&render_params);

            // Render all modulation indices for the full frame ahead of time using SIMD
            // modulation_indices[src_operator_ix][dst_operator_ix][sample_ix_within_frame]
            let src_operator_ix = operator_ix;
            for dst_operator_ix in 0..OPERATOR_COUNT {
                let param = modulation_matrix
                    .get_operator_modulation_index(src_operator_ix, dst_operator_ix);
                let buf = unsafe {
                    self.cached_modulation_indices
                        .get_unchecked_mut(src_operator_ix)
                        .get_unchecked_mut(dst_operator_ix)
                };
                param.render_raw(&render_params, buf);
            }
        }

        for sample_ix_within_frame in 0..FRAME_SIZE {
            let mut output_sample = 0.0f32;

            let base_frequency = *unsafe { base_frequencies.get_unchecked(sample_ix_within_frame) };

            for operator_ix in 0..OPERATOR_COUNT {
                let carrier_operator = unsafe { self.operators.get_unchecked_mut(operator_ix) };
                if !carrier_operator.enabled {
                    continue;
                }

                let carrier_base_frequency = unsafe {
                    *operator_base_frequencies
                        .get_unchecked(operator_ix)
                        .get_unchecked(sample_ix_within_frame)
                };
                let modulated_frequency = compute_modulated_frequency(
                    &last_samples_per_operator,
                    operator_ix,
                    sample_ix_within_frame,
                    carrier_base_frequency,
                    &last_frequencies_per_operator,
                    &self.cached_modulation_indices,
                );
                *unsafe { frequencies_per_operator.get_unchecked_mut(operator_ix) } =
                    modulated_frequency;

                let sample = carrier_operator.gen_sample(
                    modulated_frequency,
                    wavetables,
                    param_buffers,
                    &self.adsrs,
                    sample_ix_within_frame,
                    base_frequency,
                    &sample_mapping_manager.config_by_operator[operator_ix],
                );

                *unsafe { samples_per_operator.get_unchecked_mut(operator_ix) } = sample;

                output_sample += sample
                    * unsafe {
                        *rendered_output_weights
                            .get_unchecked(operator_ix)
                            .get_unchecked(sample_ix_within_frame)
                    };
                // if output_sample != 0. && !output_sample.is_normal() {
                //     panic!();
                // }
            }

            debug_assert!(output_sample == 0. || output_sample.is_normal());
            unsafe {
                *output_buffer.get_unchecked_mut(sample_ix_within_frame) =
                    dsp::clamp(-10., 10., output_sample);
            }
            std::mem::swap(&mut samples_per_operator, &mut last_samples_per_operator);
            std::mem::swap(
                &mut frequencies_per_operator,
                &mut last_frequencies_per_operator,
            );
        }

        self.last_samples = *last_samples_per_operator;
        self.last_sample_frequencies_per_operator = *last_frequencies_per_operator;

        self.effect_chain.apply_all(&render_params, output_buffer);
    }
}

#[derive(Clone, PartialEq)]
pub enum ParamSource {
    /// Each sample, the value for this param is pulled out of the parameter buffer of this index.
    /// These buffers are populated externally every frame.
    ParamBuffer(usize),
    /// Built-in smoothing to prevent clicks and pops when sliders are dragged around in the UI
    Constant {
        last_val: f32,
        cur_val: f32,
    },
    /// The value of this parameter is determined by the output of a per-voice ADSR that is
    /// triggered every time that voice is triggered.
    PerVoiceADSR(AdsrState),
    BaseFrequencyMultiplier(f32),
    MIDIControlValue {
        control_index: usize,
        scale: f32,
        shift: f32,
    },
    /// Converts the provided number of beats into samples.  If the cur BPM is 60, that equates to
    /// 1 beat per second which comes out to 44_100 samples.
    BeatsToSamples(f32),
}

impl ParamSource {
    pub fn new_constant(val: f32) -> Self {
        ParamSource::Constant {
            last_val: val,
            cur_val: val,
        }
    }

    pub fn replace(&mut self, new: Self) {
        match new {
            ParamSource::Constant {
                cur_val: new_val, ..
            } => match self {
                ParamSource::Constant {
                    last_val: old_last_val,
                    cur_val: old_cur_val,
                } => {
                    *old_last_val = *old_cur_val;
                    *old_cur_val = new_val;
                },
                other => *other = new,
            },
            _ => *self = new,
        }
    }
}

pub struct RenderRawParams<'a> {
    pub param_buffers: &'a [[f32; FRAME_SIZE]],
    pub adsrs: &'a [Adsr],
    pub base_frequencies: &'a [f32; FRAME_SIZE],
}

impl Default for ParamSource {
    fn default() -> Self {
        ParamSource::Constant {
            last_val: 0.,
            cur_val: 0.,
        }
    }
}

impl ParamSource {
    pub fn get(
        &self,
        param_buffers: &[[f32; FRAME_SIZE]],
        adsrs: &[Adsr],
        sample_ix_within_frame: usize,
        base_frequency: f32,
    ) -> f32 {
        match self {
            ParamSource::ParamBuffer(buf_ix) => {
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
            ParamSource::Constant { last_val, cur_val } => dsp::one_pole(
                unsafe { std::mem::transmute(last_val as *const _) },
                *cur_val,
                0.995,
            ),
            ParamSource::PerVoiceADSR(AdsrState {
                adsr_ix,
                scale,
                shift,
            }) => {
                let adsr = if cfg!(debug_assertions) {
                    &adsrs[*adsr_ix]
                } else {
                    unsafe { adsrs.get_unchecked(*adsr_ix) }
                };

                (unsafe {
                    *adsr
                        .get_cur_frame_output()
                        .get_unchecked(sample_ix_within_frame)
                }) * scale
                    + shift
            },
            ParamSource::BaseFrequencyMultiplier(multiplier) => base_frequency * multiplier,
            ParamSource::MIDIControlValue {
                control_index,
                scale,
                shift,
            } => unsafe { MIDI_CONTROL_VALUES[*control_index] * *scale + *shift },
            ParamSource::BeatsToSamples(beats) => {
                let cur_bpm = crate::get_cur_bpm();
                let cur_bps = cur_bpm / 60.;
                let seconds_per_beat = 1. / cur_bps;
                let samples_per_beat = seconds_per_beat * SAMPLE_RATE as f32;
                samples_per_beat * *beats
            },
        }
    }

    pub fn from_parts(
        value_type: usize,
        value_param_int: usize,
        value_param_float: f32,
        value_param_float_2: f32,
    ) -> Self {
        match value_type {
            0 => ParamSource::ParamBuffer(value_param_int),
            1 => ParamSource::Constant {
                last_val: value_param_float,
                cur_val: value_param_float,
            },
            2 => ParamSource::PerVoiceADSR(AdsrState {
                adsr_ix: value_param_int,
                scale: value_param_float,
                shift: value_param_float_2,
            }),
            3 => ParamSource::BaseFrequencyMultiplier(value_param_float),
            4 => ParamSource::MIDIControlValue {
                control_index: value_param_int,
                scale: value_param_float,
                shift: value_param_float_2,
            },
            5 => ParamSource::BeatsToSamples(value_param_float),
            _ => panic!("Invalid value type; expected [0,4]"),
        }
    }

    #[cfg(feature = "simd")]
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
            ParamSource::Constant { last_val, cur_val } => unsafe {
                let diff = (*cur_val - *last_val).abs();
                if diff < 0.000001 {
                    let splat = f32x4_splat(*cur_val);
                    let base_output_ptr = output_buf.as_ptr() as *mut v128;
                    for i in 0..FRAME_SIZE / 4 {
                        v128_store(base_output_ptr.add(i), splat);
                    }
                } else {
                    for i in 0..FRAME_SIZE {
                        output_buf[i] =
                            dsp::one_pole(&mut *(last_val as *const _ as *mut _), *cur_val, 0.995);
                    }
                }
            },
            ParamSource::ParamBuffer(buffer_ix) => {
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
            ParamSource::BaseFrequencyMultiplier(multiplier) => {
                let base_input_ptr = base_frequencies.as_ptr() as *const v128;
                let base_output_ptr = output_buf.as_ptr() as *mut v128;
                let multiplier = f32x4_splat(*multiplier);

                for i in 0..FRAME_SIZE / 4 {
                    unsafe {
                        let v = v128_load(base_input_ptr.add(i));
                        let multiplied = f32x4_mul(v, multiplier);
                        v128_store(base_output_ptr.add(i), multiplied);
                    }
                }
            },
            ParamSource::PerVoiceADSR(AdsrState {
                adsr_ix,
                scale,
                shift,
            }) => {
                let scale = f32x4_splat(*scale);
                let shift = f32x4_splat(*shift);

                let adsr = unsafe { adsrs.get_unchecked(*adsr_ix) };
                let base_output_ptr = output_buf.as_ptr() as *mut v128;
                let adsr_buf_ptr = adsr.get_cur_frame_output().as_ptr() as *const v128;

                for i in 0..FRAME_SIZE / 4 {
                    unsafe {
                        let v = v128_load(adsr_buf_ptr.add(i));
                        let scaled = f32x4_mul(v, scale);
                        let scaled_and_shifted = f32x4_add(scaled, shift);
                        v128_store(base_output_ptr.add(i), scaled_and_shifted);
                    }
                }
            },
            ParamSource::MIDIControlValue {
                control_index,
                scale,
                shift,
            } => {
                let value = unsafe {
                    f32x4_splat(*MIDI_CONTROL_VALUES.get_unchecked(*control_index) * scale + shift)
                };

                let base_output_ptr = output_buf.as_ptr() as *mut v128;
                for i in 0..FRAME_SIZE / 4 {
                    unsafe {
                        v128_store(base_output_ptr.add(i), value);
                    }
                }
            },
            ParamSource::BeatsToSamples(beats) => {
                let cur_bpm = crate::get_cur_bpm();
                let cur_bps = cur_bpm / 60.;
                let seconds_per_beat = 1. / cur_bps;
                let samples_per_beat = seconds_per_beat * SAMPLE_RATE as f32;
                let samples = samples_per_beat * *beats;

                let splat = f32x4_splat(samples);
                let base_output_ptr = output_buf.as_ptr() as *mut v128;
                for i in 0..FRAME_SIZE / 4 {
                    unsafe { v128_store(base_output_ptr.add(i), splat) };
                }
            },
        }
    }

    #[cfg(not(feature = "simd"))]
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
            ParamSource::Constant { last_val, cur_val } => {
                let diff = (*cur_val - *last_val).abs();
                if diff < 0.000001 {
                    for i in 0..FRAME_SIZE {
                        unsafe {
                            *output_buf.get_unchecked_mut(i) = *cur_val;
                        };
                    }
                } else {
                    for i in 0..FRAME_SIZE {
                        output_buf[i] = dsp::one_pole(
                            unsafe { &mut *(last_val as *const _ as *mut _) },
                            *cur_val,
                            0.995,
                        );
                    }
                }
            },
            ParamSource::ParamBuffer(buffer_ix) => {
                output_buf.clone_from_slice(unsafe { param_buffers.get_unchecked(*buffer_ix) });
            },
            ParamSource::BaseFrequencyMultiplier(multiplier) =>
                for i in 0..FRAME_SIZE {
                    unsafe {
                        *output_buf.get_unchecked_mut(i) =
                            (*base_frequencies.get_unchecked(i)) * *multiplier;
                    };
                },
            ParamSource::PerVoiceADSR(AdsrState {
                adsr_ix,
                scale,
                shift,
            }) => {
                let adsr = unsafe { adsrs.get_unchecked(*adsr_ix) };
                let adsr_buf = adsr.get_cur_frame_output();

                for i in 0..FRAME_SIZE {
                    unsafe {
                        *output_buf.get_unchecked_mut(i) =
                            (*adsr_buf.get_unchecked(i)) * (*scale) + (*shift);
                    }
                }
            },
            ParamSource::MIDIControlValue {
                control_index,
                scale,
                shift,
            } => {
                let value = unsafe { MIDI_CONTROL_VALUES[*control_index] * *scale + *shift };

                for i in 0..FRAME_SIZE {
                    unsafe {
                        *output_buf.get_unchecked_mut(i) = value;
                    }
                }
            },
            ParamSource::BeatsToSamples(beats) => {
                let cur_bpm = crate::get_cur_bpm();
                let cur_bps = cur_bpm / 60.;
                let seconds_per_beat = 1. / cur_bps;
                let samples_per_beat = seconds_per_beat * SAMPLE_RATE as f32;
                let samples = samples_per_beat * *beats;

                for i in 0..FRAME_SIZE {
                    unsafe {
                        *output_buf.get_unchecked_mut(i) = samples;
                    };
                }
            },
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
    pub most_recent_gated_voice_ix: usize,
    pub adsr_phase_buf: [f32; 256],
    pub detune: Option<ParamSource>,
    pub wavetables: Vec<WaveTable>,
    pub sample_mapping_manager: SampleMappingManager,
}

impl FMSynthContext {
    pub fn generate(&mut self) {
        for (voice_ix, voice) in self.voices.iter_mut().enumerate() {
            let base_frequency_buffer =
                unsafe { self.base_frequency_input_buffer.get_unchecked(voice_ix) };
            if unsafe { *base_frequency_buffer.get_unchecked(0) } == 0. {
                for adsr in &mut voice.adsrs {
                    if let Some(store_phase_to) = adsr.store_phase_to {
                        unsafe { *store_phase_to = 0. };
                    }
                }
                continue;
            }
            let output_buffer = unsafe { self.output_buffers.get_unchecked_mut(voice_ix) };

            voice.gen_samples(
                &mut self.modulation_matrix,
                &self.wavetables,
                &self.param_buffers,
                &self.operator_base_frequency_sources,
                base_frequency_buffer,
                output_buffer,
                self.detune.as_ref(),
                &self.sample_mapping_manager,
            );

            voice.gain_envelope.render_frame(1., 0.);
            // TODO: SIMD-ify
            let gain_adsr_output = voice.gain_envelope.get_cur_frame_output();
            for i in 0..FRAME_SIZE {
                output_buffer[i] *= gain_adsr_output[i];
            }
        }
    }

    pub fn update_operator_enabled_statuses(&mut self) {
        // Check to see if any operators need to be enabled/disabled
        for operator_ix in 0..OPERATOR_COUNT {
            // operator is disabled if it doesn't output anything and doesn't modulate any other
            // operators
            let disabled = matches!(
                self.modulation_matrix.output_weights[operator_ix],
                ParamSource::Constant { cur_val, .. } if cur_val.abs() < 0.0001
            ) && (0..OPERATOR_COUNT).all(|dst_operator_ix| {
                matches!(
                    self.modulation_matrix
                        .get_operator_modulation_index(operator_ix, dst_operator_ix),
                    ParamSource::Constant { cur_val, .. } if cur_val.abs() < 0.0001
                )
            });

            for voice_ix in 0..self.voices.len() {
                let was_disabled = !self.voices[voice_ix].operators[operator_ix].enabled;
                self.voices[voice_ix].operators[operator_ix].enabled = !disabled;

                // zero out cached modulation indices to avoid having to do so every tick
                if !was_disabled && disabled {
                    for dst_operator_ix in 0..OPERATOR_COUNT {
                        for voice in &mut self.voices {
                            voice.cached_modulation_indices[operator_ix][dst_operator_ix] =
                                [0.; FRAME_SIZE];
                        }
                    }
                }
            }
        }
    }
}

#[no_mangle]
#[cold]
pub unsafe extern "C" fn init_fm_synth_ctx(voice_count: usize) -> *mut FMSynthContext {
    crate::lookup_tables::maybe_init_lookup_tables();
    init_sample_manager();
    common::set_raw_panic_hook(log_err);

    let ctx = Box::into_raw(box FMSynthContext {
        voices: Vec::with_capacity(voice_count),
        modulation_matrix: ModulationMatrix::default(),
        param_buffers: uninit(),
        operator_base_frequency_sources: uninit(),
        base_frequency_input_buffer: Vec::with_capacity(voice_count),
        output_buffers: Vec::with_capacity(voice_count),
        most_recent_gated_voice_ix: 0,
        adsr_phase_buf: [0.; 256],
        detune: None,
        wavetables: Vec::new(),
        sample_mapping_manager: SampleMappingManager::default(),
    });
    for i in 0..OPERATOR_COUNT {
        (*ctx)
            .operator_base_frequency_sources
            .as_mut_ptr()
            .add(i)
            .write(ParamSource::BaseFrequencyMultiplier(1.));
    }
    let shared_gain_adsr_rendered_buffer: Box<[f32; RENDERED_BUFFER_SIZE]> = box uninit();
    let shared_gain_adsr_rendered_buffer: Rc<[f32; RENDERED_BUFFER_SIZE]> =
        shared_gain_adsr_rendered_buffer.into();

    for _ in 0..voice_count {
        (*ctx).voices.push(FMSynthVoice::new(Rc::clone(
            &shared_gain_adsr_rendered_buffer,
        )));
    }
    // Render the default gain envelope for all voices
    (*ctx).voices[0].gain_envelope.render();

    (*ctx).base_frequency_input_buffer.set_len(voice_count);
    (*ctx).output_buffers.set_len(voice_count);

    ctx
}

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
    val_param_float_2: f32,
) {
    let param = ParamSource::from_parts(
        value_type,
        val_param_int,
        val_param_float,
        val_param_float_2,
    );
    (*ctx).modulation_matrix.weights_per_operator[src_operator_ix][dst_operator_ix].replace(param);

    (*ctx).update_operator_enabled_statuses();
}

#[no_mangle]
pub unsafe extern "C" fn fm_synth_set_output_weight_value(
    ctx: *mut FMSynthContext,
    operator_ix: usize,
    value_type: usize,
    val_param_int: usize,
    val_param_float: f32,
    val_param_float_2: f32,
) {
    let param = ParamSource::from_parts(
        value_type,
        val_param_int,
        val_param_float,
        val_param_float_2,
    );
    (*ctx).modulation_matrix.output_weights[operator_ix].replace(param);

    (*ctx).update_operator_enabled_statuses();
}

fn initialize_phases<T: PhasedOscillator>(old_phases: &[f32], mut oscs: Vec<T>) -> Vec<T> {
    for (i, osc) in oscs.iter_mut().enumerate() {
        osc.set_phase(old_phases.get(i).copied().unwrap_or_default())
    }
    oscs
}

fn build_oscillator_source(
    operator_type: usize,
    unison: usize,
    param_0_value_type: usize,
    param_0_val_int: usize,
    param_0_val_float: f32,
    param_0_val_float_2: f32,
    param_1_value_type: usize,
    param_1_val_int: usize,
    param_1_val_float: f32,
    param_1_val_float_2: f32,
    param_2_value_type: usize,
    param_2_val_int: usize,
    param_2_val_float: f32,
    param_2_val_float_2: f32,
    param_3_value_type: usize,
    param_3_val_int: usize,
    param_3_val_float: f32,
    param_3_val_float_2: f32,
    param_4_value_type: usize,
    param_4_val_int: usize,
    param_4_val_float: f32,
    param_4_val_float_2: f32,
    old_phases: &[f32],
) -> OscillatorSource {
    match operator_type {
        0 => OscillatorSource::Wavetable(WaveTableHandle {
            wavetable_index: param_0_val_int,
            phase: old_phases.get(0).copied().unwrap_or_default(),
            dim_0_intra_mix: ParamSource::from_parts(
                param_1_value_type,
                param_1_val_int,
                param_1_val_float,
                param_1_val_float_2,
            ),
            dim_1_intra_mix: ParamSource::from_parts(
                param_2_value_type,
                param_2_val_int,
                param_2_val_float,
                param_2_val_float_2,
            ),
            inter_dim_mix: ParamSource::from_parts(
                param_3_value_type,
                param_3_val_int,
                param_3_val_float,
                param_3_val_float_2,
            ),
        }),
        1 => OscillatorSource::ParamBuffer(param_0_val_int),
        2 => OscillatorSource::Sine(SineOscillator {
            phase: old_phases.get(0).copied().unwrap_or_default(),
        }),
        3 => OscillatorSource::ExponentialOscillator(ExponentialOscillator {
            phase: old_phases.get(0).copied().unwrap_or_default(),
            stretch_factor: ParamSource::from_parts(
                param_0_value_type,
                param_0_val_int,
                param_0_val_float,
                param_0_val_float_2,
            ),
        }),
        4 => OscillatorSource::Square(SquareOscillator {
            phase: old_phases.get(0).copied().unwrap_or_default(),
        }),
        5 => OscillatorSource::Triangle(TriangleOscillator {
            phase: old_phases.get(0).copied().unwrap_or_default(),
        }),
        6 => OscillatorSource::Sawtooth(SawtoothOscillator {
            phase: old_phases.get(0).copied().unwrap_or_default(),
        }),
        7 => OscillatorSource::SampleMapping(SampleMappingEmitter::new()),
        8 => OscillatorSource::TunedSample(TunedSampleEmitter {}),
        52 => OscillatorSource::UnisonSine(UnisonOscillator {
            unison_detune_range_semitones: ParamSource::from_parts(
                param_4_value_type,
                param_4_val_int,
                param_4_val_float,
                param_4_val_float_2,
            ),
            oscillators: initialize_phases(old_phases, vec![SineOscillator { phase: 0. }; unison]),
        }),
        50 => OscillatorSource::UnisonWavetable(UnisonOscillator {
            unison_detune_range_semitones: ParamSource::from_parts(
                param_4_value_type,
                param_4_val_int,
                param_4_val_float,
                param_4_val_float_2,
            ),
            oscillators: initialize_phases(old_phases, vec![
                WaveTableHandle {
                    wavetable_index: param_0_val_int,
                    phase: old_phases.get(0).copied().unwrap_or_default(),
                    dim_0_intra_mix: ParamSource::from_parts(
                        param_1_value_type,
                        param_1_val_int,
                        param_1_val_float,
                        param_1_val_float_2,
                    ),
                    dim_1_intra_mix: ParamSource::from_parts(
                        param_2_value_type,
                        param_2_val_int,
                        param_2_val_float,
                        param_2_val_float_2,
                    ),
                    inter_dim_mix: ParamSource::from_parts(
                        param_3_value_type,
                        param_3_val_int,
                        param_3_val_float,
                        param_3_val_float_2,
                    ),
                };
                unison
            ]),
        }),
        54 => OscillatorSource::UnisonSquare(UnisonOscillator {
            unison_detune_range_semitones: ParamSource::from_parts(
                param_4_value_type,
                param_4_val_int,
                param_4_val_float,
                param_4_val_float_2,
            ),
            oscillators: initialize_phases(old_phases, vec![
                SquareOscillator { phase: 0. };
                unison
            ]),
        }),
        55 => OscillatorSource::UnisonTriangle(UnisonOscillator {
            unison_detune_range_semitones: ParamSource::from_parts(
                param_4_value_type,
                param_4_val_int,
                param_4_val_float,
                param_4_val_float_2,
            ),
            oscillators: initialize_phases(old_phases, vec![
                TriangleOscillator { phase: 0. };
                unison
            ]),
        }),
        56 => OscillatorSource::UnisonSawtooth(UnisonOscillator {
            unison_detune_range_semitones: ParamSource::from_parts(
                param_4_value_type,
                param_4_val_int,
                param_4_val_float,
                param_4_val_float_2,
            ),
            oscillators: initialize_phases(old_phases, vec![
                SawtoothOscillator { phase: 0. };
                unison
            ]),
        }),
        _ => panic!("Invalid operator type: {}", operator_type),
    }
}

#[no_mangle]
pub unsafe extern "C" fn fm_synth_set_operator_config(
    ctx: *mut FMSynthContext,
    operator_ix: usize,
    operator_type: usize,
    unison: usize,
    unison_phase_randomization_enabled: bool,
    param_0_value_type: usize,
    param_0_val_int: usize,
    param_0_val_float: f32,
    param_0_val_float_2: f32,
    param_1_value_type: usize,
    param_1_val_int: usize,
    param_1_val_float: f32,
    param_1_val_float_2: f32,
    param_2_value_type: usize,
    param_2_val_int: usize,
    param_2_val_float: f32,
    param_2_val_float_2: f32,
    param_3_value_type: usize,
    param_3_val_int: usize,
    param_3_val_float: f32,
    param_3_val_float_2: f32,
    param_4_value_type: usize,
    param_4_val_int: usize,
    param_4_val_float: f32,
    param_4_val_float_2: f32,
) {
    for voice in &mut (*ctx).voices {
        let operator = &mut voice.operators[operator_ix];
        let old_phases = operator.oscillator_source.get_phase();
        operator.oscillator_source = build_oscillator_source(
            operator_type,
            unison,
            param_0_value_type,
            param_0_val_int,
            param_0_val_float,
            param_0_val_float_2,
            param_1_value_type,
            param_1_val_int,
            param_1_val_float,
            param_1_val_float_2,
            param_2_value_type,
            param_2_val_int,
            param_2_val_float,
            param_2_val_float_2,
            param_3_value_type,
            param_3_val_int,
            param_3_val_float,
            param_3_val_float_2,
            param_4_value_type,
            param_4_val_int,
            param_4_val_float,
            param_4_val_float_2,
            &old_phases,
        );
        operator.randomize_start_phases = unison_phase_randomization_enabled;
    }
}

#[no_mangle]
pub unsafe extern "C" fn fm_synth_set_operator_base_frequency_source(
    ctx: *mut FMSynthContext,
    operator_ix: usize,
    value_type: usize,
    value_param_int: usize,
    value_param_float: f32,
    val_param_float_2: f32,
) {
    let param = ParamSource::from_parts(
        value_type,
        value_param_int,
        value_param_float,
        val_param_float_2,
    );
    (*ctx).operator_base_frequency_sources[operator_ix] = param;
}

#[no_mangle]
pub unsafe extern "C" fn fm_synth_set_detune(
    ctx: *mut FMSynthContext,
    param_type: isize,
    param_int_val: usize,
    param_float_val: f32,
    param_float_val_2: f32,
) {
    if param_type < 0 {
        (*ctx).detune = None;
        return;
    }
    let param = ParamSource::from_parts(
        param_type as usize,
        param_int_val,
        param_float_val,
        param_float_val_2,
    );
    match &mut (*ctx).detune {
        Some(old_detune) => old_detune.replace(param),
        None => (*ctx).detune = Some(param),
    }
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
    param_1_float_val_2: f32,
    param_2_type: usize,
    param_2_int_val: usize,
    param_2_float_val: f32,
    param_2_float_val_2: f32,
    param_3_type: usize,
    param_3_int_val: usize,
    param_3_float_val: f32,
    param_3_float_val_2: f32,
    param_4_type: usize,
    param_4_int_val: usize,
    param_4_float_val: f32,
    param_4_float_val_2: f32,
    is_bypassed: bool,
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
                param_1_float_val_2,
                param_2_type,
                param_2_int_val,
                param_2_float_val,
                param_2_float_val_2,
                param_3_type,
                param_3_int_val,
                param_3_float_val,
                param_3_float_val_2,
                param_4_type,
                param_4_int_val,
                param_4_float_val,
                param_4_float_val_2,
                is_bypassed,
            );
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn get_adsr_phases_buf_ptr(ctx: *mut FMSynthContext) -> *const f32 {
    (*ctx).adsr_phase_buf.as_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn gate_voice(ctx: *mut FMSynthContext, voice_ix: usize) {
    // Stop recording phases for the last recently gated voice so the new one can record them
    let old_phases_voice = &mut (*ctx).voices[(*ctx).most_recent_gated_voice_ix];
    for adsr in &mut old_phases_voice.adsrs {
        adsr.store_phase_to = None;
    }
    old_phases_voice.gain_envelope.store_phase_to = None;
    (*ctx).most_recent_gated_voice_ix = voice_ix;

    let voice = &mut (*ctx).voices[voice_ix];
    for (i, adsr) in voice.adsrs.iter_mut().enumerate() {
        adsr.store_phase_to = Some(((*ctx).adsr_phase_buf.as_mut_ptr() as *mut f32).add(i));
        adsr.gate();
    }

    voice.gain_envelope.gate();
    voice.gain_envelope.store_phase_to =
        Some(((*ctx).adsr_phase_buf.as_mut_ptr() as *mut f32).add(GAIN_ENVELOPE_PHASE_BUF_INDEX));

    for operator in &mut voice.operators {
        if operator.randomize_start_phases {
            let oscillator_count = operator.oscillator_source.get_oscillator_count();
            for osc_ix in 0..oscillator_count {
                let new_phase = common::rng().gen_range(-1., 1.);
                operator.oscillator_source.set_phase_at(new_phase, osc_ix)
            }
        } else {
            let initial_phases = &[0.];
            operator.oscillator_source.set_phase(initial_phases);
        }

        match &mut operator.oscillator_source {
            OscillatorSource::SampleMapping(emitter) => emitter.cur_ix = 0,
            OscillatorSource::TunedSample(_) => todo!(),
            _ => (),
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn ungate_voice(ctx: *mut FMSynthContext, voice_ix: usize) {
    let voice = &mut (*ctx).voices[voice_ix];

    for adsr in &mut voice.adsrs {
        adsr.ungate();
    }

    voice.gain_envelope.ungate();
}

static mut ADSR_STEP_BUFFER: [AdsrStep; 512] = [AdsrStep {
    x: 0.,
    y: 0.,
    ramper: RampFn::Linear,
}; 512];
#[no_mangle]
pub unsafe extern "C" fn set_adsr_step_buffer(i: usize, x: f32, y: f32, ramper: u32, param: f32) {
    ADSR_STEP_BUFFER[i] = AdsrStep {
        x,
        y,
        ramper: RampFn::from_u32(ramper, param),
    }
}

#[no_mangle]
pub unsafe extern "C" fn set_adsr(
    ctx: *mut FMSynthContext,
    adsr_ix: isize,
    step_count: usize,
    len_samples_type: usize,
    len_samples_int_val: usize,
    len_samples_float_val: f32,
    len_samples_float_val_2: f32,
    release_start_phase: f32,
    loop_point: f32,
    log_scale: bool,
) {
    let shared_buffer = box [0.0f32; RENDERED_BUFFER_SIZE];
    let shared_buffer: Rc<[f32; RENDERED_BUFFER_SIZE]> = shared_buffer.into();

    for voice in &mut (*ctx).voices {
        let mut new_adsr = Adsr::new(
            ADSR_STEP_BUFFER[..step_count].to_owned(),
            if loop_point < 0. {
                None
            } else {
                Some(loop_point)
            },
            0., // This will be overridden when ADSRs are rendered
            release_start_phase,
            shared_buffer.clone(),
            EarlyReleaseConfig::default(),
            log_scale,
        );
        let params = AdsrParams {
            len_samples: ParamSource::from_parts(
                len_samples_type,
                len_samples_int_val,
                len_samples_float_val,
                len_samples_float_val_2,
            ),
        };

        let old_adsr = if adsr_ix < 0 {
            Some(&mut voice.gain_envelope)
        } else {
            voice.adsrs.get_mut(adsr_ix as usize)
        };

        if let Some(old_adsr) = old_adsr {
            let old_phase = old_adsr.phase;
            let gate_status = old_adsr.gate_status;
            let store_phase_to = old_adsr.store_phase_to;

            new_adsr.phase = match gate_status {
                GateStatus::GatedFrozen => release_start_phase,
                GateStatus::Done => 1.,
                _ => old_phase,
            };
            // Switch out of frozen states into active ones to trigger one frame of samples to be
            // generated for the new ADSR
            new_adsr.gate_status = match gate_status {
                GateStatus::GatedFrozen => GateStatus::Gated,
                GateStatus::Done => GateStatus::Releasing,
                other => other,
            };
            new_adsr.store_phase_to = store_phase_to;
            *old_adsr = new_adsr;
            if adsr_ix >= 0 {
                voice.adsr_params[adsr_ix as usize] = params;
            } else {
                old_adsr.set_len_samples(len_samples_float_val);
            }
        } else if voice.adsrs.len() != adsr_ix as usize {
            panic!(
                "Tried to set ADSR index {} but only {} adsrs exist",
                adsr_ix,
                voice.adsrs.len()
            );
        } else {
            voice.adsrs.push(new_adsr);
            voice.adsr_params.push(params);
        }
    }
    // Render the ADSR's shared buffer
    if adsr_ix < 0 {
        (*ctx).voices[0].gain_envelope.render();
    } else {
        (*ctx).voices[0].adsrs[adsr_ix as usize].render();
    }
}

#[no_mangle]
pub unsafe extern "C" fn set_adsr_length(
    ctx: *mut FMSynthContext,
    adsr_ix: isize,
    len_samples_type: usize,
    len_samples_int_val: usize,
    len_samples_float_val: f32,
    len_samples_float_val_2: f32,
) {
    let param = ParamSource::from_parts(
        len_samples_type,
        len_samples_int_val,
        len_samples_float_val,
        len_samples_float_val_2,
    );

    if adsr_ix < 0 {
        // gain envelope
        for voice in &mut (*ctx).voices {
            voice.gain_envelope.set_len_samples(len_samples_float_val);
        }
        return;
    }
    let adsr_ix = adsr_ix as usize;

    for voice in &mut (*ctx).voices {
        voice.adsr_params[adsr_ix].len_samples = param.clone();
    }
}

#[no_mangle]
pub extern "C" fn fm_synth_get_wavetable_data_ptr(
    ctx: *mut FMSynthContext,
    wavetable_ix: usize,
    waveforms_per_dimension: usize,
    waveform_length: usize,
    base_frequency: f32,
) -> *mut f32 {
    let ctx = unsafe { &mut *ctx };
    let new_wavetable = WaveTable::new(WaveTableSettings {
        waveform_length,
        dimension_count: 2,
        waveforms_per_dimension,
        base_frequency,
    });
    if ctx.wavetables.get(wavetable_ix).is_some() {
        ctx.wavetables[wavetable_ix] = new_wavetable;
    } else if ctx.wavetables.len() != wavetable_ix {
        panic!(
            "Tried to set wavetable index {} but only {} wavetables exist",
            wavetable_ix,
            ctx.wavetables.len()
        );
    } else {
        ctx.wavetables.push(new_wavetable);
    }
    ctx.wavetables[wavetable_ix].samples.as_mut_ptr()
}

/// Allocates space for a new sample to be loaded into Wasm memory, returning its index in the
/// samples list
#[no_mangle]
pub extern "C" fn fm_synth_add_sample(len_samples: usize) -> usize {
    let sample_manager = sample_manager();
    let ix = sample_manager.samples.len();
    let mut buf = Vec::with_capacity(len_samples);
    unsafe { buf.set_len(len_samples) };
    sample_manager.samples.push(buf);
    ix
}

#[no_mangle]
pub extern "C" fn fm_synth_get_sample_buf_ptr(sample_ix: usize) -> *const f32 {
    sample_manager().samples[sample_ix].as_mut_ptr()
}

/// Set the number of MIDI numbers that have been mapped for a given operator
#[no_mangle]
pub extern "C" fn fm_synth_set_mapped_sample_midi_number_count(
    ctx: *mut FMSynthContext,
    operator_ix: usize,
    mapped_midi_number_count: usize,
) {
    let ctx = unsafe { &mut *ctx };
    ctx.sample_mapping_manager.config_by_operator[operator_ix]
        .set_mapped_sample_midi_number_count(mapped_midi_number_count);
}

#[no_mangle]
pub extern "C" fn fm_synth_set_mapped_sample_data_for_midi_number_slot(
    ctx: *mut FMSynthContext,
    operator_ix: usize,
    midi_number_slot_ix: usize,
    midi_number: usize,
    mapped_sample_count: usize,
) {
    let ctx = unsafe { &mut *ctx };
    ctx.sample_mapping_manager.config_by_operator[operator_ix]
        .set_mapped_sample_data_for_midi_number(
            midi_number_slot_ix,
            midi_number,
            mapped_sample_count,
        );
}

#[no_mangle]
pub extern "C" fn fm_synth_set_mapped_sample_config(
    ctx: *mut FMSynthContext,
    operator_ix: usize,
    midi_number_ix: usize,
    mapped_sample_ix: usize,
    sample_data_ix: isize,
    do_loop: bool,
) {
    let ctx = unsafe { &mut *ctx };
    ctx.sample_mapping_manager.config_by_operator[operator_ix]
        .set_mapped_sample_config_for_midi_number(
            midi_number_ix,
            mapped_sample_ix,
            sample_data_ix,
            do_loop,
        )
}
