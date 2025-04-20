const FRAME_SIZE = 128;

class EqualizerAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor(_options) {
    super({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });

    this.isShutdown = false;
    this.ctxPtr = 0;
    this.wasmInstance = null;
    this.wasmMemoryBuffer = null;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          this.initWasmInstance(evt.data.wasmBytes);
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        case 'setInitialState': {
          this.ctxPtr = this.wasmInstance.exports.equalizer_init();
          this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
          const {
            state: { bands },
          } = evt.data;
          for (let bandIx = 0; bandIx < bands.length; bandIx++) {
            const { filterType, frequency, q, gain } = bands[bandIx];
            this.wasmInstance.exports.equalizer_set_band(
              this.ctxPtr,
              bandIx,
              filterType,
              frequency,
              q,
              gain
            );
          }
          break;
        }
        case 'setBand': {
          const { bandIx, filterType, frequency, q, gain } = evt.data;
          this.wasmInstance.exports.equalizer_set_band(
            this.ctxPtr,
            bandIx,
            filterType,
            frequency,
            q,
            gain
          );
          break;
        }
        default:
          console.error('Unknown message type in EqualizerAWP', evt.data.type);
      }
    };
  }

  logWasmErr = (ptr, len) => {
    const mem = new Uint8Array(this.wasmInstance.exports.memory.buffer);
    const slice = mem.subarray(ptr, ptr + len);
    const str = String.fromCharCode(...slice);
    console.error(str);
  };

  async initWasmInstance(wasmBytes) {
    const importObject = { env: { log_err: (ptr, len) => this.logWasmErr(ptr, len) } };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);

    this.port.postMessage({ type: 'ready' });
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  /**
   *
   * @param {Float32Array[][]} inputs
   * @param {Float32Array[][]} outputs
   * @param {{[key: string]: Float32Array}} _params
   * @returns {boolean}
   */
  process(inputs, outputs, _params) {
    const input = inputs[0]?.[0];
    if (!input) {
      return true;
    }
    const output = outputs[0]?.[0];
    if (!output) {
      return true;
    }
    if (this.isShutdown) {
      console.warn('mix AWP shut down');
      return false;
    }
    if (!this.ctxPtr) {
      return true;
    }

    const wasmMemory = this.getWasmMemoryBuffer();
    const inputPtr = this.wasmInstance.exports.equalizer_get_io_buf_ptr(this.ctxPtr);
    wasmMemory.set(input, inputPtr / Float32Array.BYTES_PER_ELEMENT);

    this.wasmInstance.exports.equalizer_process(this.ctxPtr);

    output.set(
      wasmMemory.subarray(
        inputPtr / Float32Array.BYTES_PER_ELEMENT,
        inputPtr / Float32Array.BYTES_PER_ELEMENT + FRAME_SIZE
      )
    );

    return true;
  }
}

registerProcessor('equalizer-awp', EqualizerAWP);
