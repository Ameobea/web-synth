const SAMPLE_RATE = 44_100;
const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;
const SAB_SIZE = 16 * BYTES_PER_F32;

class CompressorAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'mix',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1,
      },
      {
        name: 'pre_gain',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 20,
      },
      {
        name: 'post_gain',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 20,
      },
      {
        name: 'low_band_gain',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 20,
      },
      {
        name: 'mid_band_gain',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 20,
      },
      {
        name: 'high_band_gain',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'low_band_attack_ms',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'low_band_release_ms',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'mid_band_attack_ms',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'mid_band_release_ms',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'high_band_attack_ms',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'high_band_release_ms',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'low_band_bottom_threshold_db',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: -100,
        maxValue: 24,
      },
      {
        name: 'mid_band_bottom_threshold_db',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: -100,
        maxValue: 24,
      },
      {
        name: 'high_band_bottom_threshold_db',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: -100,
        maxValue: 24,
      },
      {
        name: 'low_band_top_threshold_db',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: -100,
        maxValue: 24,
      },
      {
        name: 'mid_band_top_threshold_db',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: -100,
        maxValue: 24,
      },
      {
        name: 'high_band_top_threshold_db',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: -100,
        maxValue: 24,
      },
      {
        name: 'low_band_bottom_ratio',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1024,
      },
      {
        name: 'mid_band_bottom_ratio',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1024,
      },
      {
        name: 'high_band_bottom_ratio',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1024,
      },
      {
        name: 'low_band_top_ratio',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1024,
      },
      {
        name: 'mid_band_top_ratio',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1024,
      },
      {
        name: 'high_band_top_ratio',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 1024,
      },
      {
        name: 'knee',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 40,
      },
      {
        name: 'lookahead_ms',
        defaultValue: 0,
        automationRate: 'k-rate',
        minValue: 0,
        maxValue: 100,
      },
    ];
  }

  constructor(_options) {
    super({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });

    this.isShutdown = false;
    this.sab = typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(SAB_SIZE) : null;
    if (this.sab) {
      this.port.postMessage({ type: 'sab', sab: this.sab });
    }
    this.sabView = this.sab ? new Float32Array(this.sab) : null;
    this.sabPtr = 0;
    this.wasmInstance = null;
    this.ctxPtr = 0;
    this.inputBufPtr = 0;
    this.outputBufPtr = 0;
    this.bypass = false;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          this.initWasm(evt.data.wasmBytes);
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        case 'setBypassed': {
          this.bypass = evt.data.bypass;
          break;
        }
        default:
          console.error('Unknown message type in CompressorAWP', evt.data.type);
      }
    };
  }

  async initWasm(wasmBytes) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, {
      env: { log_raw: (ptr, len, level) => this.logFromWasm(ptr, len, level) },
    });

    this.ctxPtr = this.wasmInstance.exports.init_compressor();
    this.inputBufPtr = this.wasmInstance.exports.get_compressor_input_buf_ptr(this.ctxPtr);
    this.outputBufPtr = this.wasmInstance.exports.get_compressor_output_buf_ptr(this.ctxPtr);
    this.sabPtr = this.wasmInstance.exports.get_sab_ptr(this.ctxPtr);
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  logFromWasm(ptr, len, level) {
    const str = String.fromCharCode.apply(
      null,
      new Uint8Array(this.wasmMemoryBuffer.buffer).subarray(ptr, ptr + len)
    );
    const levelStr =
      {
        0: 'error',
        1: 'warn',
        2: 'info',
      }[level] || 'log';
    console[levelStr](str);
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
      console.warn('compressor shut down');
      return false;
    }

    if (this.bypass) {
      output.set(input);
      return true;
    }

    const wasmMemory = this.getWasmMemoryBuffer();
    const inputBuffer = wasmMemory.subarray(
      this.inputBufPtr / BYTES_PER_F32,
      this.inputBufPtr / BYTES_PER_F32 + FRAME_SIZE
    );
    inputBuffer.set(input);

    const mix = params.mix[0];
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
    const lowBandThresholdBottomDb = params.low_band_bottom_threshold_db[0];
    const midBandThresholdBottomDb = params.mid_band_bottom_threshold_db[0];
    const highBandThresholdBottomDb = params.high_band_bottom_threshold_db[0];
    const lowBandThresholdTopDb = params.low_band_top_threshold_db[0];
    const midBandThresholdTopDb = params.mid_band_top_threshold_db[0];
    const highBandThresholdTopDb = params.high_band_top_threshold_db[0];
    const lowBandBottomRatio = params.low_band_bottom_ratio[0];
    const midBandBottomRatio = params.mid_band_bottom_ratio[0];
    const highBandBottomRatio = params.high_band_bottom_ratio[0];
    const lowBandTopRatio = params.low_band_top_ratio[0];
    const midBandTopRatio = params.mid_band_top_ratio[0];
    const highBandTopRatio = params.high_band_top_ratio[0];
    const knee = params.knee[0];
    const lookaheadSamples = Math.floor(params.lookahead_ms[0] * 0.001 * SAMPLE_RATE);

    this.wasmInstance.exports.process_compressor(
      this.ctxPtr,
      mix,
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
      lowBandThresholdBottomDb,
      midBandThresholdBottomDb,
      highBandThresholdBottomDb,
      lowBandThresholdTopDb,
      midBandThresholdTopDb,
      highBandThresholdTopDb,
      lowBandBottomRatio,
      midBandBottomRatio,
      highBandBottomRatio,
      lowBandTopRatio,
      midBandTopRatio,
      highBandTopRatio,
      knee,
      lookaheadSamples
    );

    const outputBuffer = wasmMemory.subarray(
      this.outputBufPtr / BYTES_PER_F32,
      this.outputBufPtr / BYTES_PER_F32 + FRAME_SIZE
    );
    output.set(outputBuffer);

    if (this.sab) {
      // Copy raw bytes from wasm memory to the SAB
      this.sabView.set(
        wasmMemory.subarray(
          this.sabPtr / BYTES_PER_F32,
          this.sabPtr / BYTES_PER_F32 + SAB_SIZE / BYTES_PER_F32
        )
      );
    }

    return true;
  }
}

registerProcessor('compressor-awp', CompressorAWP);
