use dsp::filters::biquad::{compute_higher_order_biquad_q_factors, BiquadFilter, FilterMode};

const SAMPLE_RATE: usize = 44_100;
const NYQUIST: f32 = SAMPLE_RATE as f32 / 2.;
const FRAME_SIZE: usize = 128;

#[repr(u8)]
#[derive(Clone, Copy)]
pub enum SensingMethod {
    Peak = 0,
    RMS = 1,
}

const BAND_SPLITTER_FILTER_ORDER: usize = 16;
const BAND_SPLITTER_FILTER_CHAIN_LENGTH: usize = BAND_SPLITTER_FILTER_ORDER / 2;

#[derive(Clone)]
pub struct Compressor {
    pub sensing_method: SensingMethod,
    pub input_buffer: [f32; FRAME_SIZE],
    pub low_band_input_buffer: [f32; FRAME_SIZE],
    pub mid_band_input_buffer: [f32; FRAME_SIZE],
    pub high_band_input_buffer: [f32; FRAME_SIZE],
    pub low_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH],
    pub mid_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH * 2],
    pub high_band_filter_chain: [BiquadFilter; BAND_SPLITTER_FILTER_CHAIN_LENGTH],
    pub output_buffer: [f32; FRAME_SIZE],
}

impl Default for Compressor {
    fn default() -> Self {
        let low_band_cutoff = 88.3;
        let mid_band_cutoff = 2500.;

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
                low_band_cutoff,
                0.,
            );
            mid_band_bottom_filter_chain[i].set_coefficients(
                FilterMode::Highpass,
                q_factors[i],
                0.,
                low_band_cutoff + 7.5,
                0.,
            );
            mid_band_top_filter_chain[i].set_coefficients(
                FilterMode::Lowpass,
                q_factors[i],
                0.,
                mid_band_cutoff - 184.8,
                0.,
            );
            high_band_filter_chain[i].set_coefficients(
                FilterMode::Highpass,
                q_factors[i],
                0.,
                mid_band_cutoff,
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
            low_band_input_buffer: [0.0; FRAME_SIZE],
            mid_band_input_buffer: [0.0; FRAME_SIZE],
            high_band_input_buffer: [0.0; FRAME_SIZE],
            low_band_filter_chain,
            mid_band_filter_chain,
            high_band_filter_chain,
            output_buffer: [0.0; FRAME_SIZE],
        }
    }
}

fn apply_filter_chain<const N: usize>(chain: &mut [BiquadFilter; N], sample: f32) -> f32 {
    let mut result = sample;
    for filter in chain.iter_mut() {
        let input = result;
        let output = filter.apply(input);
        if !input.is_nan() && output.is_nan() {
            // panic!();
        }
        result = output;
    }
    result
}

fn apply_filter_chain_full<const N: usize>(
    chain: &mut [BiquadFilter; N],
    input_buf: [f32; FRAME_SIZE],
    output_buf: &mut [f32; FRAME_SIZE],
    gain: f32,
) {
    for i in 0..FRAME_SIZE {
        let output = apply_filter_chain(chain, input_buf[i]);
        output_buf[i] = output * gain;
    }
}

impl Compressor {
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
            &mut self.low_band_input_buffer,
            low_band_gain,
        );
        apply_filter_chain_full(
            &mut self.mid_band_filter_chain,
            self.input_buffer,
            &mut self.mid_band_input_buffer,
            mid_band_gain,
        );
        apply_filter_chain_full(
            &mut self.high_band_filter_chain,
            self.input_buffer,
            &mut self.high_band_input_buffer,
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
    ) {
        // apply pre gain
        for i in 0..FRAME_SIZE {
            self.input_buffer[i] *= pre_gain;
        }

        self.apply_bandsplitting(low_band_gain, mid_band_gain, high_band_gain);

        // TODO: Actually apply compression

        // Merge bands + apply post gain
        for i in 0..FRAME_SIZE {
            self.output_buffer[i] = (self.low_band_input_buffer[i]
                + self.mid_band_input_buffer[i]
                + self.high_band_input_buffer[i])
                * post_gain;
        }
    }
}

#[no_mangle]
pub extern "C" fn init_compressor() -> *mut Compressor {
    let compressor = Compressor::default();
    Box::into_raw(Box::new(compressor))
}

#[no_mangle]
pub extern "C" fn get_compressor_input_buf_ptr(compressor: *mut Compressor) -> *mut f32 {
    let compressor = unsafe { &mut *compressor };
    compressor.input_buffer.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn get_compressor_output_buf_ptr(compressor: *mut Compressor) -> *mut f32 {
    let compressor = unsafe { &mut *compressor };
    compressor.output_buffer.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn process_compressor(
    compressor: *mut Compressor,
    pre_gain: f32,
    post_gain: f32,
    low_band_gain: f32,
    mid_band_gain: f32,
    high_band_gain: f32,
) {
    let compressor = unsafe { &mut *compressor };
    compressor.apply(
        pre_gain,
        post_gain,
        low_band_gain,
        mid_band_gain,
        high_band_gain,
    );
}
