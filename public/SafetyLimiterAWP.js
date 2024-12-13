class SafetyLimiterAWP extends AudioWorkletProcessor {
  constructor() {
    super();

    this.isShutdown = false;
    this.wasmInstance = null;
    this.ioBufPtr = 0;
    this.wasmMemoryBuffer = null;

    this.port.onmessage = evt => this.handleMessage(evt.data);
  }

  handleMessage(data) {
    switch (data.type) {
      case 'setWasmBytes': {
        this.initWasm(data.wasmBytes);
        break;
      }
      default: {
        console.error('Unhandled message type in safety limiter AWP: ', evt.data.type);
      }
    }
  }

  /**
   * @param {ArrayBuffer} wasmBytes
   */
  async initWasm(wasmBytes) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, { env: {} });
    this.ioBufPtr = this.wasmInstance.exports.safety_limiter_get_io_buffer_ptr();
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer?.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  process(inputs, outputs, _params) {
    if (!this.ioBufPtr || this.isShutdown) {
      return false;
    }

    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) {
      return true;
    }

    const wasmMemory = this.getWasmMemoryBuffer();
    const sampleCount = input.length;
    let ioBuf = wasmMemory.subarray(
      this.ioBufPtr / Float32Array.BYTES_PER_ELEMENT,
      this.ioBufPtr / Float32Array.BYTES_PER_ELEMENT + sampleCount
    );
    ioBuf.set(input);

    this.wasmInstance.exports.safety_limiter_process();

    if (ioBuf.length === 0) {
      ioBuf = this.getWasmMemoryBuffer().subarray(
        this.ioBufPtr / Float32Array.BYTES_PER_ELEMENT,
        this.ioBufPtr / Float32Array.BYTES_PER_ELEMENT + sampleCount
      );
    }

    return true;
  }
}

registerProcessor('safety-limiter-awp', SafetyLimiterAWP);
