const clamp = (min, max, value) => Math.min(max, Math.max(min, value));

// This function maps a linear value, like that from a control knob or slider, to an output
// value that is exponential in nature.  For example, it's useful for controlling the cutoff
// frequency of a filter.
//
// The steepness represents the ratio between the minimum and maximum values of the portion
// of the exponential curve that we're mapping to.  This allows us to handle mapping to output
// ranges that start at 0 or contain negative values.
//
// So a steepness value of (44100 / 2) / 20 would be appropriate for mapping to a frequency
// range for a filter.
const mkLinearToExponential = (xMin, xMax, yMin, yMax, steepness) => {
  if (steepness <= 1) {
    throw new Error('steepness must be greater than 1');
  }

  const inputRange = xMax - xMin;
  if (inputRange <= 0) {
    console.warn('Found invalid input range, returning a constant function.', { xMin, xMax });
    return () => yMin;
  }
  const outputRange = yMax - yMin;

  return x => {
    const normalizedX = clamp(0, 1, (x - xMin) / inputRange);
    return yMin + (outputRange * (steepness ** normalizedX - 1)) / (steepness - 1);
  };
};

// This function is the inverse of `mkLinearToExponential`.
//
// It first normalizes the input `y` value to the range [0, 1], then maps that to the
// corresponding `x` value in the range [0, 1] of the exponential curve.  Finally, it
// maps that `x` value back to the original input range.
const mkExponentialToLinear = (yMin, yMax, xMin, xMax, steepness) => {
  if (steepness <= 1) {
    throw new Error('steepness must be greater than 1');
  }

  const inputRange = xMax - xMin;
  if (inputRange <= 0) {
    console.warn('Found invalid input range, returning a constant function.', { xMin, xMax });
    return () => yMin;
  }
  const outputRange = yMax - yMin;

  return y => {
    const normalizedY = clamp(0, 1, (y - yMin) / outputRange);
    return xMin + (inputRange * Math.log(1 + normalizedY * (steepness - 1))) / Math.log(steepness);
  };
};

class ScaleAndShiftAWP extends AudioWorkletProcessor {
  constructor() {
    super();

    // `true` if converting linear to exponential, `false` if converting exponential to linear
    this.linearToExponential = true;
    this.steepness = 44_100 / 2 / 20;
    this.inputMin = 0;
    this.inputMax = 1;
    this.outputMin = 0;
    this.outputMax = 1;

    this.updateConvertFn();

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setParams':
          this.linearToExponential = evt.data.linearToExponential;
          this.steepness = evt.data.steepness;
          this.inputMin = evt.data.inputMin;
          this.inputMax = evt.data.inputMax;
          this.outputMin = evt.data.outputMin;
          this.outputMax = evt.data.outputMax;
          this.updateConvertFn();
          this.computeAndPostResponsePlot();
          break;
        default:
          console.error('Unknown message type', evt.data.type);
      }
    };
  }

  updateConvertFn() {
    this.convert = this.linearToExponential
      ? mkLinearToExponential(
          this.inputMin,
          this.inputMax,
          this.outputMin,
          this.outputMax,
          this.steepness
        )
      : mkExponentialToLinear(
          this.inputMin,
          this.inputMax,
          this.outputMin,
          this.outputMax,
          this.steepness
        );
  }

  /**
   * We render a little graph showing the response of the conversion function.
   *
   * We do it here on the audio thread so that the conversion functions can be
   * re-used without duplicating the code.
   */
  computeAndPostResponsePlot() {
    const SAMPLE_COUNT = 100;
    const input = new Float32Array(SAMPLE_COUNT);
    const output = new Float32Array(SAMPLE_COUNT);
    const step = (this.inputMax - this.inputMin) / (SAMPLE_COUNT - 1);
    const inputRange = this.inputMax - this.inputMin;

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      input[i] = this.inputMin + i * step;
      if (inputRange <= 0) {
        output[i] = +'x';
      } else {
        output[i] = this.convert(input[i]);
      }
    }
    this.port.postMessage({ type: 'responsePlot', input, output });
  }

  process(inputs, outputs, _params) {
    const input = inputs[0]?.[0];
    if (!input) {
      return true;
    }

    const output = outputs[0]?.[0];
    if (!output) {
      return true;
    }

    for (let i = 0; i < input.length; i += 1) {
      const value = clamp(this.inputMin, this.inputMax, input[i]);
      const convertedValue = this.convert(value);
      output[i] = convertedValue;
    }

    return true;
  }
}

registerProcessor('scale-and-shift-awp', ScaleAndShiftAWP);
