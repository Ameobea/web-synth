const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;

class LevelDetectorWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'window_size_samples',
        automationRate: 'k-rate',
        minValue: 0,
      },
    ];
  }

  constructor() {
    super();

    this.wasmInstance = null;
    this.ctxPtr = 0;
    this.wasmMemoryBuffer = null;
    this.detectedLevelSAB =
      typeof SharedArrayBuffer === 'undefined' ? null : new SharedArrayBuffer(4 * BYTES_PER_F32);
    this.detectedLevelBufF32 = this.detectedLevelSAB
      ? new Float32Array(this.detectedLevelSAB)
      : null;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          this.initWasm(evt.data.wasmBytes);
          break;
        }
        default: {
          console.warn('Unhandled message type in level detector AWP: ', evt.data.type);
        }
      }
    };

    if (this.detectedLevelBufF32) {
      this.port.postMessage({ type: 'detectedLevelSAB', sab: this.detectedLevelSAB });
    }
  }

  handleWasmPanic = (ptr, len) => {
    const mem = new Uint8Array(this.getWasmMemoryBuffer().buffer);
    const slice = mem.subarray(ptr, ptr + len);
    const str = String.fromCharCode(...slice);
    console.error(`LevelDetectorAWP Wasm panic: ${str}`);
  };

  async initWasm(wasmBytes) {
    const importObject = { env: { log_err: (ptr, len) => this.handleWasmPanic(ptr, len) } };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    this.ctxPtr = this.wasmInstance.exports.level_detector_create_ctx();
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
  }

  /**
   * @param {Float32Array[][]} _inputs
   * @param {Float32Array[][]} outputs
   * @param {{[key: string]: Float32Array}} params
   * @returns {boolean}
   */
  process(inputs, outputs, params) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];

    if (!input || !output || !this.wasmInstance) {
      return true;
    }

    const ioBufPtr = this.wasmInstance.exports.level_detector_get_io_buf_ptr(this.ctxPtr);
    const ioBuf = this.wasmMemoryBuffer.subarray(
      ioBufPtr / BYTES_PER_F32,
      ioBufPtr / BYTES_PER_F32 + FRAME_SIZE
    );
    ioBuf.set(input);

    const windowSizeSamples = params.window_size_samples[0];
    this.wasmInstance.exports.level_detector_process(this.ctxPtr, windowSizeSamples);

    if (this.detectedLevelBufF32) {
      this.detectedLevelBufF32[0] = ioBuf[ioBuf.length - 1];
    }

    output.set(ioBuf);

    return true;
  }
}

registerProcessor('level-detector-awp', LevelDetectorWorkletProcessor);
