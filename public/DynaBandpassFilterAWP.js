const SAMPLE_RATE = 44_100;
const FRAME_SIZE = 128;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Frequency is a log scale, so we need to increase the bandwidth as the base frequency increases.
 *
 * Given the frequency of the center of a band and its width when the band's center is 10 Hz,
 * this function returns the width of the band when the base frequency is the given frequency.
 *
 * @param {number} baseFrequency
 * @param {number} baseBandWidth
 * @param {number} frequency
 * @returns {number}
 */
const computeModifiedBandWidth = (baseFrequency, baseBandWidth, frequency) => {
  const logBaseFrequency = Math.log10(baseFrequency + baseBandWidth / 2);
  const logFrequency = Math.log10(frequency);
  const logBaseBandWidth = Math.log10(baseBandWidth);
  return Math.pow(10, logBaseBandWidth + (logFrequency - logBaseFrequency));
};

class DynaBandpassFilterAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'center_frequency',
        defaultValue: 0,
        automationRate: 'a-rate',
        minValue: 0,
        maxValue: SAMPLE_RATE / 2,
      },
      {
        name: 'base_band_width',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: SAMPLE_RATE / 2,
      },
    ];
  }

  constructor() {
    super();

    this.lastFrequency = 0;
  }

  /**
   * @param {Float32Array[][]} _inputs
   * @param {Float32Array[][]} outputs
   * @param {{[key: string]: Float32Array}} params
   * @returns {boolean}
   */
  process(_inputs, outputs, params) {
    const lowPassOutput = outputs[0]?.[0];
    const highPassOutput = outputs[1]?.[0];
    if (!lowPassOutput || !highPassOutput) {
      return true;
    }

    const baseFrequencies = params.center_frequency;
    const baseBandWidth = params.base_band_width[0];
    let frequency = this.lastFrequency;

    for (let i = 0; i < FRAME_SIZE; i++) {
      const rawFrequency = baseFrequencies.length === 1 ? baseFrequencies[0] : baseFrequencies[i];
      // low-pass filter frequency to prevent clicks and glitches
      frequency = 0.95 * frequency + 0.05 * rawFrequency;
      const bandWidth = computeModifiedBandWidth(10, baseBandWidth, frequency);
      const highPassFrequency = clamp(frequency - bandWidth / 2, 10, SAMPLE_RATE / 2);
      const lowPassFrequency = clamp(frequency + bandWidth / 2, 10, SAMPLE_RATE / 2);
      lowPassOutput[i] = lowPassFrequency;
      highPassOutput[i] = highPassFrequency;
    }

    this.lastFrequency = frequency;
    return true;
  }
}

registerProcessor('dyna-bandpass-filter-awp', DynaBandpassFilterAWP);
