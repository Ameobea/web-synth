const FRAME_SIZE = 128;

class VocoderAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'carrier_gain',
        automationRate: 'k-rate',
      },
      {
        name: 'modulator_gain',
        automationRate: 'k-rate',
      },
      {
        name: 'post_gain',
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();

    this.wasmInstance = null;
    this.wasmMemoryBuffer = null;
    this.ctxPtr = 0;

    this.port.onmessage = event => this.handleMessage(event.data);
  }

  handleWasmPanic = (ptr, len) => {
    const mem = new Uint8Array(this.wasmInstance.exports.memory.buffer);
    const slice = mem.subarray(ptr, ptr + len);
    const str = String.fromCharCode(...slice);
    console.error(str);
  };

  async initWasm(wasmBytes, filterParams) {
    const importObject = { env: { log_err: (ptr, len) => this.handleWasmPanic(ptr, len) } };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    // this.wasmInstance.exports.memory.grow(1024 * 4);

    const filterParamsBufPtr = this.wasmInstance.exports.get_filter_params_buf_ptr();
    const paramsBuf = new Float32Array(this.wasmInstance.exports.memory.buffer).subarray(
      filterParamsBufPtr / 4,
      filterParamsBufPtr / 4 + filterParams.length
    );
    paramsBuf.set(filterParams);

    this.ctxPtr = this.wasmInstance.exports.vocoder_create_ctx();
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'setWasmBytes':
        const { wasmBytes, filterParams } = msg;
        this.initWasm(wasmBytes, filterParams);
        break;
      default:
        console.warn('Unhandled message type in vocoder AWP: ', msg.type);
    }
  }

  /**
   *
   * @param {Float32Array[][]} _inputs
   * @param {Float32Array[][]} outputs
   * @param {{[key: string]: Float32Array}} params
   * @returns {boolean}
   */
  process(inputs, outputs, params) {
    if (!this.wasmInstance) {
      return true;
    }

    const carrier = inputs[0]?.[0];
    const modulator = inputs[1]?.[0];
    const output = outputs[0]?.[0];
    if (!carrier || !modulator || !output) {
      return true;
    }

    const carrierInputBufPtr = this.wasmInstance.exports.vocoder_get_carrier_input_buf_ptr(
      this.ctxPtr
    );
    const carrierInputBuf = this.wasmMemoryBuffer.subarray(
      carrierInputBufPtr / 4,
      carrierInputBufPtr / 4 + FRAME_SIZE
    );
    if (carrier.length === 1) {
      carrierInputBuf.fill(carrier[0]);
    } else {
      carrierInputBuf.set(carrier);
    }

    const modulatorInputBufPtr = this.wasmInstance.exports.vocoder_get_modulator_input_buf_ptr(
      this.ctxPtr
    );
    const modulatorInputBuf = this.wasmMemoryBuffer.subarray(
      modulatorInputBufPtr / 4,
      modulatorInputBufPtr / 4 + FRAME_SIZE
    );
    if (modulator.length === 1) {
      modulatorInputBuf.fill(modulator[0]);
    } else {
      modulatorInputBuf.set(modulator);
    }

    const carrierGain = params.carrier_gain[0];
    const modulatorGain = params.modulator_gain[0];
    const postGain = params.post_gain[0];

    this.wasmInstance.exports.vocoder_process(this.ctxPtr, carrierGain, modulatorGain, postGain);

    const outputBufPtr = this.wasmInstance.exports.vocoder_get_output_buf_ptr(this.ctxPtr);
    const outputBuf = this.wasmMemoryBuffer.subarray(
      outputBufPtr / 4,
      outputBufPtr / 4 + FRAME_SIZE
    );
    output.set(outputBuf);

    return true;
  }
}

registerProcessor('vocoder-awp', VocoderAWP);
