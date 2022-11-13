const SAMPLE_RATE = 44_100;
const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;
const SAB_SIZE = 16 * BYTES_PER_F32;

class CompressorAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'pre_gain',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 20,
      },
      {
        name: 'post_gain',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 20,
      },
      {
        name: 'low_band_gain',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 20,
      },
      {
        name: 'mid_band_gain',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 20,
      },
      {
        name: 'high_band_gain',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'low_band_attack_ms',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'low_band_release_ms',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'mid_band_attack_ms',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'mid_band_release_ms',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'high_band_attack_ms',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'high_band_release_ms',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'threshold_db',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: -100,
        maxValue: 24,
      },
      {
        name: 'ratio',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0.01,
        maxValue: 1024,
      },
      {
        name: 'knee',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 40,
      },
      {
        name: 'lookahead_ms',
        defaultValue: 1,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 100,
      },
    ];
  }

  constructor(options) {
    super({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });

    this.isShutdown = false;
    this.sab = typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(SAB_SIZE) : null;
    this.wasmInstance = null;
    this.ctxPtr = 0;
    this.inputBufPtr = 0;
    this.outputBufPtr = 0;

    this.port.onmessage = async evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          await this.initWasm(evt.data.wasmBytes);
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        default:
          console.error('Unknown message type in CompressorAWP', evt.data.type);
      }
    };
  }

  async initWasm(wasmBytes) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule);

    this.ctxPtr = this.wasmInstance.exports.init_compressor();
    this.inputBufPtr = this.wasmInstance.exports.get_input_buf_ptr(this.ctxPtr);
    this.outputBufPtr = this.wasmInstance.exports.get_output_buf_ptr(this.ctxPtr);
  }

  /**
   *
   * @param {Float32Array[][]} inputs
   * @param {Float32Array[][]} outputs
   * @param {{[key: string]: Float32Array}} params
   * @returns {boolean}
   */
  process(inputs, outputs, params) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output || !this.ctxPtr) {
      return true;
    } else if (this.isShutdown) {
      return false;
    }

    const preGain = params.pre_gain[0];
    const postGain = params.post_gain[0];
    const lowBandGain = params.low_band_gain[0];
    const midBandGain = params.mid_band_gain[0];
    const highBandGain = params.high_band_gain[0];
    const lowBandAttackMs = params.low_band_attack_ms[0];
    const lowBandReleaseMs = params.low_band_release_ms[0];
    const midBandAttackMs = params.mid_band_attack_ms[0];
    const midBandReleaseMs = params.mid_band_release_ms[0];
    const highBandAttackMs = params.high_band_attack_ms[0];
    const highBandReleaseMs = params.high_band_release_ms[0];
    const thresholdDb = params.threshold_db[0];
    const ratio = params.ratio[0];
    const knee = params.knee[0];
    const lookaheadSamples = Math.floor(params.lookahead_ms[0] * 0.001 * SAMPLE_RATE);

    this.wasmInstance.exports.process_compressor(
      preGain,
      postGain,
      lowBandGain,
      midBandGain,
      highBandGain,
      lowBandAttackMs,
      lowBandReleaseMs,
      midBandAttackMs,
      midBandReleaseMs,
      highBandAttackMs,
      highBandReleaseMs,
      thresholdDb,
      ratio,
      knee,
      lookaheadSamples
    );

    return true;
  }
}

registerProcessor('compressor-awp', CompressorAWP);
