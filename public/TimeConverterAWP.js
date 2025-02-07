const FRAME_SIZE = 128;
const SAMPLE_RATE = 44_100;

const getToSecondsMultiplier = fromUnit => {
  const curBPM = globalThis.globalTempoBPM;

  return {
    beats: 60 / curBPM,
    seconds: 1,
    milliseconds: 1 / 1000,
    samples: 1 / SAMPLE_RATE,
  }[fromUnit];
};

const getMultiplier = (fromUnit, toUnit) => {
  const curBPM = globalThis.globalTempoBPM;

  return {
    beats: {
      beats: 1,
      seconds: 60 / curBPM,
      milliseconds: 60000 / curBPM,
      samples: (60 / curBPM) * SAMPLE_RATE,
    },
    milliseconds: {
      beats: curBPM / 60000,
      seconds: 1 / 1000,
      milliseconds: 1,
      samples: SAMPLE_RATE / 1000,
    },
    seconds: {
      beats: curBPM / 60,
      seconds: 1,
      milliseconds: 1000,
      samples: SAMPLE_RATE,
    },
    samples: {
      beats: curBPM / (60 * SAMPLE_RATE),
      seconds: 1 / SAMPLE_RATE,
      milliseconds: 1000 / SAMPLE_RATE,
      samples: 1,
    },
  }[fromUnit]?.[toUnit];
};

class TimeConverterAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  onStateChanged() {
    this.multiplier = getMultiplier(this.state.fromUnit, this.state.toUnit);
  }

  constructor(_options) {
    super({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });

    this.isShutdown = false;
    this.state = { fromUnit: 'beats', toUnit: 'milliseconds' };
    this.multiplier = 1;
    this.didReportInitialized = false;
    this.onStateChanged();

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        case 'setState': {
          this.state = evt.data.state;
          this.onStateChanged();
          if (!this.didReportInitialized) {
            this.didReportInitialized = true;
            this.port.postMessage({ type: 'initialized' });
          }
          break;
        }
        default:
          console.error('Unknown message type in TimeConverterAWP', evt.data.type);
      }
    };
  }

  /**
   *
   * @param {Float32Array[][]} inputs
   * @param {Float32Array[][]} outputs
   * @param {{[key: string]: Float32Array}} params
   * @returns {boolean}
   */
  process(inputs, outputs, _params) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) {
      return true;
    }
    if (this.isShutdown) {
      console.warn('Time Converter AWP shut down');
      return false;
    }

    if (input.length === 1) {
      if (typeof this.multiplier === 'number') {
        const out = input[0] * this.multiplier;
        output.fill(out);
      } else {
        let inputInSeconds;
        switch (this.state.fromUnit) {
          case 'hz':
            inputInSeconds = 1 / input[0];
            break;
          default:
            inputInSeconds = input[0] * getToSecondsMultiplier(this.state.fromUnit);
        }

        switch (this.state.toUnit) {
          case 'hz':
            output.fill(1 / inputInSeconds);
            break;
          default:
            output.fill(inputInSeconds / getToSecondsMultiplier(this.state.toUnit));
        }
      }
    } else if (input.length === FRAME_SIZE) {
      if (typeof this.multiplier === 'number') {
        for (let i = 0; i < FRAME_SIZE; i++) {
          output[i] = input[i] * this.multiplier;
        }
      } else {
        switch (this.state.fromUnit) {
          case 'hz':
            for (let i = 0; i < FRAME_SIZE; i++) {
              output[i] = 1 / input[i];
            }
            break;
          default:
            const multiplier = getToSecondsMultiplier(this.state.fromUnit);
            for (let i = 0; i < FRAME_SIZE; i++) {
              output[i] = input[i] * multiplier;
            }
        }

        switch (this.state.toUnit) {
          case 'hz':
            for (let i = 0; i < FRAME_SIZE; i++) {
              output[i] = 1 / output[i];
            }
            break;
          default:
            const multiplier = getToSecondsMultiplier(this.state.toUnit);
            for (let i = 0; i < FRAME_SIZE; i++) {
              output[i] /= multiplier;
            }
        }
      }
    } else {
      throw new Error('Unexpected input length');
    }

    return true;
  }
}

registerProcessor('time-converter-awp', TimeConverterAWP);
