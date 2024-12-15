const SAB_SIZE_F32 = 3;
const FRAME_SIZE = 128;

class SafetyLimiterAWP extends AudioWorkletProcessor {
  constructor() {
    super();

    this.isShutdown = false;
    this.wasmInstance = null;
    this.ioBufPtr = 0;
    this.sabBufPtr = 0;
    this.wasmMemoryBuffer = null;

    this.port.onmessage = evt => this.handleMessage(evt.data);
  }

  handleMessage(data) {
    switch (data.type) {
      case 'setWasmBytes': {
        this.initWasm(data.wasmBytes);
        break;
      }
      case 'shutdown': {
        this.isShutdown = true;
        break;
      }
      default: {
        console.error('Unhandled message type in safety limiter AWP: ', data.type);
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
    this.sabBufPtr = this.wasmInstance.exports.safety_limiter_get_sab_buf_ptr();
    this.sab =
      typeof SharedArrayBuffer !== 'undefined'
        ? new SharedArrayBuffer(SAB_SIZE_F32 * Float32Array.BYTES_PER_ELEMENT)
        : null;
    if (this.sab) {
      this.port.postMessage({ type: 'sab', sab: this.sab });
    }
    this.sabView = this.sab ? new Float32Array(this.sab) : null;
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer?.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  process(inputs, outputs, _params) {
    if (this.isShutdown) {
      return false;
    } else if (!this.ioBufPtr) {
      return true;
    }

    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) {
      return true;
    }

    const wasmMemory = this.getWasmMemoryBuffer();
    let ioBuf = wasmMemory.subarray(
      this.ioBufPtr / Float32Array.BYTES_PER_ELEMENT,
      this.ioBufPtr / Float32Array.BYTES_PER_ELEMENT + FRAME_SIZE
    );
    ioBuf.set(input);

    this.wasmInstance.exports.safety_limiter_process();

    if (ioBuf.length === 0) {
      wasmMemory = this.getWasmMemoryBuffer();
      ioBuf = wasmMemory.subarray(
        this.ioBufPtr / Float32Array.BYTES_PER_ELEMENT,
        this.ioBufPtr / Float32Array.BYTES_PER_ELEMENT + FRAME_SIZE
      );
    }

    output.set(ioBuf);

    if (this.sabView) {
      const sabBuf = wasmMemory.subarray(
        this.sabBufPtr / Float32Array.BYTES_PER_ELEMENT,
        this.sabBufPtr / Float32Array.BYTES_PER_ELEMENT + SAB_SIZE_F32
      );
      this.sabView.set(sabBuf);
    }

    return true;
  }
}

registerProcessor('safety-limiter-awp', SafetyLimiterAWP);
