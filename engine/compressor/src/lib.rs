use dsp::{
    circular_buffer::CircularBuffer,
    filters::biquad::{compute_higher_order_biquad_q_factors, BiquadFilter, FilterMode},
    SAMPLE_RATE,
};

const FRAME_SIZE: usize = 128;

#[repr(u8)]
#[derive(Clone, Copy)]
pub enum SensingMethod {
    Peak = 0,
    RMS = 1,
}

const BAND_SPLITTER_FILTER_ORDER: usize = 16;
const BAND_SPLITTER_FILTER_CHAIN_LENGTH: usize = BAND_SPLITTER_FILTER_ORDER / 2;
// 50ms
const MAX_LOOKAHEAD_SAMPLES: usize = SAMPLE_RATE as usize / 20;
const LOW_BAND_CUTOFF: f32 = 88.3;
const MID_BAND_CUTOFF: f32 = 2500.;

#[derive(Clone, Default)]
pub struct Compressor {
    pub envelope: f32,
}

#[derive(Clone)]
pub struct MultibandCompressor {
    pub sensing_method: SensingMethod,
    pub input_buffer: [f32; FRAME_SIZE],
    pub low_band_lookahead_buffer: CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
    pub mid_band_lookahead_buffer: CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
    pub high_band_lookahead_buffer: CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
    pub low_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH],
    pub mid_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH * 2],
    pub high_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH],
    pub low_band_compressor: Compressor,
    pub mid_band_compressor: Compressor,
    pub high_band_compressor: Compressor,
    pub output_buffer: [f32; FRAME_SIZE],
}

impl Default for MultibandCompressor {
    fn default() -> Self {
        let q_factors = compute_higher_order_biquad_q_factors(BAND_SPLITTER_FILTER_ORDER);
        assert_eq!(q_factors.len(), BAND_SPLITTER_FILTER_CHAIN_LENGTH);
        let mut low_band_filter_chain =
            [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
        let mut mid_band_bottom_filter_chain =
            [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
        let mut mid_band_top_filter_chain =
            [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
        let mut high_band_filter_chain =
            [BiquadFilter::default(); BAND_SPLITTER_FILTER_CHAIN_LENGTH];
        for i in 0..q_factors.len() {
            low_band_filter_chain[i].set_coefficients(
                FilterMode::Lowpass,
                q_factors[i],
                0.,
                LOW_BAND_CUTOFF,
                0.,
            );
            mid_band_bottom_filter_chain[i].set_coefficients(
                FilterMode::Highpass,
                q_factors[i],
                0.,
                LOW_BAND_CUTOFF + 7.5,
                0.,
            );
            mid_band_top_filter_chain[i].set_coefficients(
                FilterMode::Lowpass,
                q_factors[i],
                0.,
                MID_BAND_CUTOFF - 184.8,
                0.,
            );
            high_band_filter_chain[i].set_coefficients(
                FilterMode::Highpass,
                q_factors[i],
                0.,
                MID_BAND_CUTOFF,
                0.,
            );
        }

        // Mid band is twice as long because it needs top and bottom filters
        let mid_band_filter_chain = [
            mid_band_bottom_filter_chain[0],
            mid_band_bottom_filter_chain[1],
            mid_band_bottom_filter_chain[2],
            mid_band_bottom_filter_chain[3],
            mid_band_bottom_filter_chain[4],
            mid_band_bottom_filter_chain[5],
            mid_band_bottom_filter_chain[6],
            mid_band_bottom_filter_chain[7],
            mid_band_top_filter_chain[0],
            mid_band_top_filter_chain[1],
            mid_band_top_filter_chain[2],
            mid_band_top_filter_chain[3],
            mid_band_top_filter_chain[4],
            mid_band_top_filter_chain[5],
            mid_band_top_filter_chain[6],
            mid_band_top_filter_chain[7],
        ];

        Self {
            sensing_method: SensingMethod::Peak,
            input_buffer: [0.0; FRAME_SIZE],
            low_band_lookahead_buffer: CircularBuffer::new(),
            mid_band_lookahead_buffer: CircularBuffer::new(),
            high_band_lookahead_buffer: CircularBuffer::new(),
            low_band_filter_chain,
            mid_band_filter_chain,
            high_band_filter_chain,
            low_band_compressor: Compressor::default(),
            mid_band_compressor: Compressor::default(),
            high_band_compressor: Compressor::default(),
            output_buffer: [0.0; FRAME_SIZE],
        }
    }
}

fn apply_filter_chain<const N: usize>(chain: &mut [BiquadFilter; N], sample: f32) -> f32 {
    let mut result = sample;
    for filter in chain.iter_mut() {
        result = filter.apply(result);
    }
    result
}

fn apply_filter_chain_full<const N: usize>(
    chain: &mut [BiquadFilter; N],
    input_buf: [f32; FRAME_SIZE],
    output_lookahead_buf: &mut CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
    gain: f32,
) {
    for i in 0..FRAME_SIZE {
        let output = apply_filter_chain(chain, input_buf[i]);
        output_lookahead_buf.set(output * gain);
    }
}

fn detect_level_peak(
    buf: &CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
    lookahead_samples: isize,
    sample_ix_in_frame: usize,
) -> f32 {
    // Might be cool to SIMD-ize this if we can't figure out a more efficient level detection method
    let mut max = 0.;
    for i in 0..lookahead_samples {
        let ix = -lookahead_samples - FRAME_SIZE as isize + sample_ix_in_frame as isize + i;
        let sample = buf.get(ix);
        if sample.abs() > max {
            max = sample.abs();
        }
    }
    max
}

/// Given the attack time in milliseconds, compute the coefficient for a one-pole lowpass filter to
/// be used in the envelope follower.
fn compute_attack_coefficient(attack_time_ms: f32) -> f32 {
    let attack_time_s = attack_time_ms * 0.001;
    let attack_time_samples = attack_time_s * SAMPLE_RATE;
    let attack_coefficient = 1. - 1. / attack_time_samples;
    attack_coefficient
}

/// Given the release time in milliseconds, compute the coefficient for a one-pole highpass filter
/// to be used in the envelope follower.
fn compute_release_coefficient(release_time_ms: f32) -> f32 {
    let release_time_s = release_time_ms * 0.001;
    let release_time_samples = release_time_s * SAMPLE_RATE;
    let release_coefficient = 1. / release_time_samples;
    release_coefficient
}

impl Compressor {
    pub fn apply(
        &mut self,
        input_buf: &CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
        lookahead_samples: usize,
        output_buf: &mut [f32; FRAME_SIZE],
        attack_ms: f32,
        release_ms: f32,
        threshold_db: f32,
        ratio: f32,
        knee: f32,
        sensing_method: SensingMethod,
    ) {
        let mut envelope = self.envelope;

        let lookahead_samples = lookahead_samples as isize;
        let attack_coefficient = compute_attack_coefficient(attack_ms);
        let release_coefficient = compute_release_coefficient(release_ms);

        let threshold = db_to_linear(threshold_db);
        let knee = db_to_linear(knee);

        for i in 0..FRAME_SIZE {
            // run level detection
            let detected_level = match sensing_method {
                SensingMethod::Peak => detect_level_peak(input_buf, lookahead_samples, i),
                SensingMethod::RMS => unimplemented!(),
            };

            let input = input_buf.get(-lookahead_samples - FRAME_SIZE as isize + i as isize);
            let input_abs = input.abs();

            // Compute the envelope
            if detected_level > envelope {
                envelope = attack_coefficient * envelope + (1. - attack_coefficient) * input_abs;
            } else {
                envelope = release_coefficient * envelope + (1. - release_coefficient) * input_abs;
            }

            // Compute the gain
            let gain = if envelope < threshold - knee {
                1.
            } else if envelope < threshold + knee {
                let x = envelope - (threshold - knee);
                let a = 1. / (2. * knee);
                let b = (1. / ratio - 1.) * knee;
                1. - a * x * x + b * x
            } else {
                1. / ratio
            };

            // Apply the gain
            output_buf[i] = input * gain;
        }

        self.envelope = envelope;
    }
}

// TODO: check out fastapprox exp
fn pow10(x: f32) -> f32 { (x * 2.30258509299404568402).exp() }

fn db_to_linear(threshold_db: f32) -> f32 {
    // 10f32.powf(threshold_db / 20.)
    pow10(threshold_db / 20.)
}

impl MultibandCompressor {
    #[inline]
    pub fn apply_bandsplitting(
        &mut self,
        low_band_gain: f32,
        mid_band_gain: f32,
        high_band_gain: f32,
    ) {
        apply_filter_chain_full(
            &mut self.low_band_filter_chain,
            self.input_buffer,
            &mut self.low_band_lookahead_buffer,
            low_band_gain,
        );
        apply_filter_chain_full(
            &mut self.mid_band_filter_chain,
            self.input_buffer,
            &mut self.mid_band_lookahead_buffer,
            mid_band_gain,
        );
        apply_filter_chain_full(
            &mut self.high_band_filter_chain,
            self.input_buffer,
            &mut self.high_band_lookahead_buffer,
            high_band_gain,
        );
    }

    #[inline]
    pub fn apply(
        &mut self,
        pre_gain: f32,
        post_gain: f32,
        low_band_gain: f32,
        mid_band_gain: f32,
        high_band_gain: f32,
        low_band_attack_ms: f32,
        low_band_release_ms: f32,
        mid_band_attack_ms: f32,
        mid_band_release_ms: f32,
        high_band_attack_ms: f32,
        high_band_release_ms: f32,
        threshold_db: f32,
        ratio: f32,
        knee: f32,
        lookahead_samples: usize,
    ) {
        // apply pre gain
        if pre_gain != 1. {
            for i in 0..FRAME_SIZE {
                self.input_buffer[i] *= pre_gain;
            }
        }

        self.apply_bandsplitting(low_band_gain, mid_band_gain, high_band_gain);

        self.output_buffer.fill(0.);

        // Apply compression to each band
        let sensing_method = SensingMethod::Peak;
        self.low_band_compressor.apply(
            &self.low_band_lookahead_buffer,
            lookahead_samples,
            &mut self.output_buffer,
            low_band_attack_ms,
            low_band_release_ms,
            threshold_db,
            ratio,
            knee,
            sensing_method,
        );
        self.mid_band_compressor.apply(
            &self.mid_band_lookahead_buffer,
            lookahead_samples,
            &mut self.output_buffer,
            mid_band_attack_ms,
            mid_band_release_ms,
            threshold_db,
            ratio,
            knee,
            sensing_method,
        );
        self.high_band_compressor.apply(
            &self.high_band_lookahead_buffer,
            lookahead_samples,
            &mut self.output_buffer,
            high_band_attack_ms,
            high_band_release_ms,
            threshold_db,
            ratio,
            knee,
            sensing_method,
        );

        // apply post gain
        if post_gain != 1. {
            for i in 0..FRAME_SIZE {
                self.output_buffer[i] *= post_gain;
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn init_compressor() -> *mut MultibandCompressor {
    let compressor = MultibandCompressor::default();
    Box::into_raw(Box::new(compressor))
}

#[no_mangle]
pub extern "C" fn get_compressor_input_buf_ptr(compressor: *mut MultibandCompressor) -> *mut f32 {
    let compressor = unsafe { &mut *compressor };
    compressor.input_buffer.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn get_compressor_output_buf_ptr(compressor: *mut MultibandCompressor) -> *mut f32 {
    let compressor = unsafe { &mut *compressor };
    compressor.output_buffer.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn process_compressor(
    compressor: *mut MultibandCompressor,
    pre_gain: f32,
    post_gain: f32,
    low_band_gain: f32,
    mid_band_gain: f32,
    high_band_gain: f32,
    low_band_attack_ms: f32,
    low_band_release_ms: f32,
    mid_band_attack_ms: f32,
    mid_band_release_ms: f32,
    high_band_attack_ms: f32,
    high_band_release_ms: f32,
    threshold_db: f32,
    ratio: f32,
    knee: f32,
    lookahead_samples: usize,
) {
    let compressor = unsafe { &mut *compressor };
    compressor.apply(
        pre_gain,
        post_gain,
        low_band_gain,
        mid_band_gain,
        high_band_gain,
        low_band_attack_ms,
        low_band_release_ms,
        mid_band_attack_ms,
        mid_band_release_ms,
        high_band_attack_ms,
        high_band_release_ms,
        threshold_db,
        ratio,
        knee,
        lookahead_samples,
    );
}
