const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;

class SidechainWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.bypassed = false;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          this.initWasm(evt.data.wasmBytes);
          break;
        }
        case 'setWindowSizeSamples': {
          if (this.wasmInstance) {
            this.wasmInstance.exports.set_window_size_samples(evt.data.windowSizeSamples);
          }
          break;
        }
        case 'setLowpassCoefficient': {
          if (this.wasmInstance) {
            this.wasmInstance.exports.set_lowpass_coefficient(evt.data.lowpassCoefficient);
          }
          break;
        }
        case 'setRangeMultiplier': {
          if (this.wasmInstance) {
            this.wasmInstance.exports.set_range_multiplier(evt.data.rangeMultiplier);
          }
          break;
        }
        case 'setBypass': {
          this.bypassed = evt.data.bypass;
          break;
        }
        default: {
          console.warn('Unhandled message type in sidechain AWP: ', evt.data.type);
        }
      }
    };
  }

  async initWasm(wasmBytes) {
    const importObject = { env: {} };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    this.inputsBufPtr = this.wasmInstance.exports.init(FRAME_SIZE);
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);

    this.port.postMessage({ type: 'wasmInitialized' });
  }

  process(inputs, outputs, _params) {
    if (!inputs[0]?.[0] || !outputs[0]?.[0] || !this.wasmInstance || this.bypassed) {
      return true;
    }

    // Copy inputs to Wasm + compute
    this.wasmMemoryBuffer.set(inputs[0][0], this.inputsBufPtr / BYTES_PER_F32);
    this.wasmInstance.exports.process();

    // Copy outputs out; samples are written in-place
    const outputsSlice = this.wasmMemoryBuffer.subarray(
      this.inputsBufPtr / BYTES_PER_F32,
      this.inputsBufPtr / BYTES_PER_F32 + FRAME_SIZE
    );
    outputs[0][0].set(outputsSlice);

    return true;
  }
}

registerProcessor('sidechain-audio-worklet-node-processor', SidechainWorkletProcessor);
