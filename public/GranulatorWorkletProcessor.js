const clamp = (min, max, val) => Math.min(Math.max(min, val), max);

const FRAME_SIZE = 128;

class GranulatorWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'start_sample',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'end_sample',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();

    this.samples = new Float32Array(0);
    this.i = 0;
    this.isShutdown = false;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setSamples': {
          this.samples = evt.data.samples;
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
        }
        default: {
          console.warn('Unhandled msg event type in granulator AWP: ', evt.data.type);
        }
      }
    };
  }

  process(_inputs, outputs, params) {
    if (this.isShutdown) {
      return false;
    }
    if (outputs.length === 0) {
      return true;
    } else if (outputs[0].length === 0) {
      throw new Error('Output 0 must have at least one channel for impl detail reasons');
    }

    const startSampleIx = clamp(0, this.samples.length, Math.trunc(params['start_sample'][0]));
    const endSampleIx = clamp(
      startSampleIx,
      this.samples.length,
      Math.trunc(params['end_sample'][0])
    );
    if (endSampleIx <= startSampleIx) {
      return true;
    }

    // Fill the first output buffer and then copy them to all other outputs
    const dstBuffer = outputs[0][0];
    const sampleCount = endSampleIx - startSampleIx;
    for (let outIx = 0; outIx < FRAME_SIZE; outIx++) {
      this.i += 1;
      if (this.i > sampleCount || startSampleIx + this.i >= this.samples.length) {
        this.i = 0;
      }
      dstBuffer[outIx] = this.samples[startSampleIx + this.i];
      if (Number.isNaN(dstBuffer[outIx])) {
        throw new Error();
      }
    }

    for (let outputIx = 0; outputIx < outputs.length; outputIx++) {
      for (let channelIx = 0; channelIx < outputs[outputIx].length; channelIx++) {
        if (outputIx === 0 && channelIx === 0) {
          continue;
        }

        outputs[outputIx][channelIx].set(dstBuffer);
      }
    }

    return true;
  }
}

registerProcessor('granulator-audio-worklet-processor', GranulatorWorkletProcessor);
