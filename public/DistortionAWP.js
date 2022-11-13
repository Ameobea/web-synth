const FRAME_SIZE = 128;
const LEN_SAMPLES = 100; // TODO: Make configurable
const BYTES_PER_F32 = 32 / 8;

class DistortionAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'stretch factor',
        defaultValue: 0,
        minValue: -1,
        maxValue: 1,
        automationRate: 'a-rate',
      },
    ];
  }

  async initWasmInstance(wasmBytes) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, { env: {} });

    this.ctxPtr = this.wasmInstance.exports.distortion_init_ctx(LEN_SAMPLES);
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
  }

  handleMessage(data) {
    switch (data.type) {
      case 'setWasmBytes': {
        this.initWasmInstance(data.wasmBytes);
        break;
      }
      case 'shutdown': {
        this.isShutdown = true;
        break;
      }
      default: {
        console.error('Unhandled message type in distortion AWP: ', evt.data.type);
      }
    }
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  constructor() {
    super();

    this.isShutdown = false;
    this.ctxPtr = 0;
    this.port.onmessage = evt => this.handleMessage(evt.data);
  }

  /**
   *
   * @param {Float32Array[][]} inputs
   * @param {Float32Array[][]} outputs
   * @param {{[key: string]: Float32Array}} params
   * @returns {boolean}
   */
  process(inputs, outputs, params) {
    if (this.isShutdown) {
      return false;
    } else if (!this.ctxPtr || !inputs[0]?.[0]) {
      return true;
    }

    const wasmMemory = this.getWasmMemoryBuffer();

    // Set params
    const stretchFactorBufPtr = this.wasmInstance.exports.distortion_get_param_buffer_pr(
      this.ctxPtr
    );
    const param = params['stretch factor'];
    if (param.length === 1) {
      wasmMemory.fill(
        param[0],
        stretchFactorBufPtr / 4,
        (stretchFactorBufPtr + FRAME_SIZE * BYTES_PER_F32) / 4
      );
    } else {
      wasmMemory.set(param, stretchFactorBufPtr / 4);
    }

    // Set inputs
    const inputBufPtr = this.wasmInstance.exports.distortion_get_sample_buffer_ptr(this.ctxPtr);
    wasmMemory.set(inputs[0][0], inputBufPtr / 4);

    // Compute
    this.wasmInstance.exports.distortion_process(this.ctxPtr);

    // Read outputs out (written in-place)
    outputs[0][0].set(
      wasmMemory.subarray(inputBufPtr / 4, (inputBufPtr + FRAME_SIZE * BYTES_PER_F32) / 4)
    );

    return true;
  }
}

registerProcessor('distortion-awp', DistortionAWP);
