const clamp = (min, max, val) => Math.min(Math.max(min, val), max);

const BYTES_PER_F32 = 4;
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
      {
        name: 'grain_size',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'grain_speed_ratio',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'sample_speed_ratio',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'voice_1_filter_cutoff',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'voice_2_filter_cutoff',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
    ];
  }

  async initWasm(wasmBytes) {
    const importObject = { env: {} };

    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    if (this.samples) {
      this.initGranularCtx();
    }
    // We'll set the samples when we receive them if we haven't already
  }

  initGranularCtx() {
    this.granularInstCtxPtr = this.wasmInstance.exports.create_granular_instance();
    const waveformPtr = this.wasmInstance.exports.get_granular_waveform_ptr(
      this.granularInstCtxPtr,
      this.samples.length
    );
    new Float32Array(this.wasmInstance.exports.memory.buffer).set(
      this.samples,
      waveformPtr / BYTES_PER_F32
    );
  }

  constructor() {
    super();

    this.samples = null;
    this.i = 0;
    this.isShutdown = false;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setSamples': {
          this.samples = evt.data.samples;
          if (this.wasmInstance) {
            this.initGranularCtx();
          }
          break;
        }
        case 'setWasmBytes': {
          this.initWasm(evt.data.wasmBytes);
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
    if (outputs.length === 0 || !this.samples || !this.wasmInstance || !this.granularInstCtxPtr) {
      return true;
    } else if (outputs[0].length === 0) {
      throw new Error('Output 0 must have at least one channel for impl detail reasons');
    }

    const startSampleIx = clamp(0, this.samples.length, params['start_sample'][0]);
    const endSampleIx = clamp(startSampleIx, this.samples.length, params['end_sample'][0]);
    if (endSampleIx <= startSampleIx) {
      return true;
    }

    const grainSize = params['grain_size'][0];
    const grainSpeedRatio = params['grain_speed_ratio'][0];
    const sampleSpeedRatio = params['sample_speed_ratio'][0];
    const voice1FilterCutoff = params['voice_1_filter_cutoff'][0];
    const voice2FilterCutoff = params['voice_2_filter_cutoff'][0];

    // Render
    const outputBufPtr = this.wasmInstance.exports.render_granular(
      this.granularInstCtxPtr,
      startSampleIx,
      endSampleIx,
      grainSize,
      grainSpeedRatio,
      sampleSpeedRatio,
      voice1FilterCutoff,
      voice2FilterCutoff
    );

    // Fill the first output buffer and then copy them to all other outputs
    const dstBuffer = outputs[0][0];
    const output = new Float32Array(this.wasmInstance.exports.memory.buffer).slice(
      outputBufPtr / BYTES_PER_F32,
      outputBufPtr / BYTES_PER_F32 + FRAME_SIZE
    );
    dstBuffer.set(output);

    // const sampleCount = endSampleIx - startSampleIx;
    // for (let outIx = 0; outIx < FRAME_SIZE; outIx++) {
    //   this.i += 1;
    //   if (this.i > sampleCount || startSampleIx + this.i >= this.samples.length) {
    //     this.i = 0;
    //   }
    //   dstBuffer[outIx] = this.samples[startSampleIx + this.i];
    //   if (Number.isNaN(dstBuffer[outIx])) {
    //     throw new Error();
    //   }
    // }

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
