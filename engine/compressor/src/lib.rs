use dsp::{
    circular_buffer::CircularBuffer,
    db_to_gain,
    filters::biquad::{compute_higher_order_biquad_q_factors, BiquadFilter, FilterMode},
    gain_to_db, SAMPLE_RATE,
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
const SAB_SIZE: usize = 16;

// SAB Layout:
// 0: low band detected level
// 1: mid band detected level
// 2: high band detected level
// 3: low band envelope level
// 4: mid band envelope level
// 5: high band envelope level
// 6: low band output level
// 7: mid band output level
// 8: high band output level

#[derive(Clone, Default)]
pub struct Compressor {
    pub envelope: f32,
    pub last_detected_level_linear: f32,
    pub last_output_level_db: f32,
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
    pub sab: [f32; SAB_SIZE],
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
            sab: [0.0; SAB_SIZE],
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

#[inline(never)]
fn detect_level_peak(
    buf: &CircularBuffer<MAX_LOOKAHEAD_SAMPLES>,
    lookahead_samples: isize,
    sample_ix_in_frame: usize,
    old_max: f32,
) -> f32 {
    // Try to fast-path.  If the old max hasn't been removed from the lookahead buffer yet and it's
    // still the max, then we can just return it.
    // let cur_sample = buf
    //     .get(-(FRAME_SIZE as isize) + sample_ix_in_frame as isize)
    //     .abs();
    // let removed_sample_ix = -lookahead_samples - FRAME_SIZE as isize + sample_ix_in_frame as
    // isize; let removed_sample = buf.get(removed_sample_ix);
    // if removed_sample != old_max {
    //     return cur_sample.max(old_max);
    // }

    // Might be cool to SIMD-ize this if we can't figure out a more efficient level detection method
    let mut max = 0.;
    for i in 0..lookahead_samples {
        let ix = -lookahead_samples - FRAME_SIZE as isize + sample_ix_in_frame as isize + i;
        let abs_sample = buf.get(ix).abs();
        if abs_sample > max {
            max = abs_sample;
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

/// Given a frame of samples, computes the average volume of the frame in decibels.
fn compute_average_volume(samples: [f32; FRAME_SIZE]) -> f32 {
    let mut sum = 0.;
    for sample in samples.iter() {
        sum += sample * sample;
    }
    let average_volume = sum / FRAME_SIZE as f32;
    average_volume.log10() * 20.
}

impl Compressor {
    /// Returns target gain in linear units.
    fn apply_compression_curve(
        input_volume_linear: f32,
        threshold_linear: f32,
        ratio: f32,
        knee: f32,
    ) -> f32 {
        // TODO: support soft knee
        if input_volume_linear < threshold_linear {
            return input_volume_linear;
        }

        (1. / ratio) * input_volume_linear
    }

    fn compute_makeup_gain(threshold_linear: f32, ratio: f32, knee: f32) -> f32 {
        // TODO: support soft knee
        let full_range_gain = Self::apply_compression_curve(1., threshold_linear, ratio, knee);
        // inverse of full_range_gain
        let full_range_makup_gain = 1. / full_range_gain;
        full_range_makup_gain.powf(0.6)
    }

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
    ) -> f32 {
        let mut envelope = self.envelope;

        let lookahead_samples = lookahead_samples as isize;
        let attack_coefficient = compute_attack_coefficient(attack_ms);
        let release_coefficient = compute_release_coefficient(release_ms);

        let threshold_linear = db_to_gain(threshold_db);
        let makeup_gain = Self::compute_makeup_gain(threshold_linear, ratio, knee);
        let mut detected_level_db = 0.;
        let mut detected_level_linear = self.last_detected_level_linear;
        let mut target_volume_db = 0.;

        for i in 0..FRAME_SIZE {
            // run level detection
            detected_level_linear = match sensing_method {
                SensingMethod::Peak => detect_level_peak(input_buf, 1800, i, detected_level_linear),
                SensingMethod::RMS => unimplemented!(),
            };
            detected_level_db = gain_to_db(detected_level_linear);

            // Compute the envelope
            if detected_level_db > envelope {
                envelope =
                    attack_coefficient * envelope + (1. - attack_coefficient) * detected_level_db;
            } else {
                envelope =
                    release_coefficient * envelope + (1. - release_coefficient) * detected_level_db;
            }

            // Compute the gain.
            // TODO: Add support for soft knee
            let gain = if envelope > threshold_db {
                target_volume_db = threshold_db + (envelope - threshold_db) / ratio;
                let target_volume_linear = db_to_gain(target_volume_db);
                // detected_level_linear * x = target_volume_linear
                // x = target_volume_linear / detected_level_linear
                target_volume_linear / detected_level_linear
            } else {
                target_volume_db = envelope;
                1.
            };

            if gain > 5. {
                panic!(
                    "gain={}, envelope={}, threshold_db={}, ratio={}",
                    gain, envelope, threshold_db, ratio
                );
            }

            // Apply the gain
            let input = input_buf.get(-lookahead_samples - FRAME_SIZE as isize + i as isize);
            output_buf[i] += input * gain * makeup_gain;
        }

        self.envelope = envelope;
        self.last_detected_level_linear = detected_level_linear;
        self.last_output_level_db = target_volume_db;
        detected_level_db
    }
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
        low_band_threshold_db: f32,
        mid_band_threshold_db: f32,
        high_band_threshold_db: f32,
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
        let low_band_detected_level = self.low_band_compressor.apply(
            &self.low_band_lookahead_buffer,
            lookahead_samples,
            &mut self.output_buffer,
            low_band_attack_ms,
            low_band_release_ms,
            low_band_threshold_db,
            ratio,
            knee,
            sensing_method,
        );
        self.sab[0] = low_band_detected_level;
        self.sab[3] = self.low_band_compressor.envelope;
        self.sab[6] = self.low_band_compressor.last_output_level_db;
        let mid_band_detected_level = self.mid_band_compressor.apply(
            &self.mid_band_lookahead_buffer,
            lookahead_samples,
            &mut self.output_buffer,
            mid_band_attack_ms,
            mid_band_release_ms,
            mid_band_threshold_db,
            ratio,
            knee,
            sensing_method,
        );
        self.sab[1] = mid_band_detected_level;
        self.sab[4] = self.mid_band_compressor.envelope;
        self.sab[7] = self.mid_band_compressor.last_output_level_db;
        let high_band_detected_level = self.high_band_compressor.apply(
            &self.high_band_lookahead_buffer,
            lookahead_samples,
            &mut self.output_buffer,
            high_band_attack_ms,
            high_band_release_ms,
            high_band_threshold_db,
            ratio,
            knee,
            sensing_method,
        );
        self.sab[2] = high_band_detected_level;
        self.sab[5] = self.high_band_compressor.envelope;
        self.sab[8] = self.high_band_compressor.last_output_level_db;

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
pub extern "C" fn get_sab_ptr(compressor: *mut MultibandCompressor) -> *mut f32 {
    let compressor = unsafe { &mut *compressor };
    compressor.sab.as_mut_ptr()
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
    low_band_threshold_db: f32,
    mid_band_threshold_db: f32,
    high_band_threshold_db: f32,
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
        low_band_threshold_db,
        mid_band_threshold_db,
        high_band_threshold_db,
        ratio,
        knee,
        lookahead_samples,
    );
}
