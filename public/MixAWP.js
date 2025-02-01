const FRAME_SIZE = 128;

class MixAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'mix',
        defaultValue: 0,
        automationRate: 'a-rate',
        minValue: 0,
        maxValue: 1,
      },
      {
        name: 'inputA',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
      {
        name: 'inputB',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
    ];
  }

  constructor(_options) {
    super({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });

    this.isShutdown = false;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        default:
          console.error('Unknown message type in MixAWP', evt.data.type);
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
  process(_inputs, outputs, params) {
    const output = outputs[0]?.[0];
    if (!output) {
      return true;
    }
    if (this.isShutdown) {
      console.warn('mix AWP shut down');
      return false;
    }

    const mixes = params.mix;
    const inputA = params.inputA;
    const inputB = params.inputB;

    if (mixes.length === 1) {
      const mix = mixes[0];
      for (let i = 0; i < FRAME_SIZE; i += 1) {
        const a = inputA.length === 1 ? inputA[0] : inputA[i];
        const b = inputB.length === 1 ? inputB[0] : inputB[i];
        output[i] = a * (1 - mix) + b * mix;
      }
    } else if (mixes.length === FRAME_SIZE) {
      for (let i = 0; i < FRAME_SIZE; i += 1) {
        const mix = mixes[i];
        const a = inputA.length === 1 ? inputA[0] : inputA[i];
        const b = inputB.length === 1 ? inputB[0] : inputB[i];
        output[i] = a * (1 - mix) + b * mix;
      }
    } else {
      return true;
    }

    return true;
  }
}

registerProcessor('mix-awp', MixAWP);
