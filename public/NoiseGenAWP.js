const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;

class NoiseGeneratorWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.port.onmessage = async evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          await this.initWasm(evt.data.wasmBytes);
          this.wasmInstance.exports.set_gain(evt.data.gain);
          this.wasmInstance.exports.set_smoothing_coefficient(evt.data.smoothingCoefficient);
          this.wasmInstance.exports.set_noise_type(evt.data.noiseType, evt.data.updateFreqSamples);
          this.wasmInstance.exports.set_quantization_factor(evt.data.quantizationFactor);
          break;
        }
        case 'setGain': {
          if (!this.wasmInstance) {
            return;
          }
          this.wasmInstance.exports.set_gain(evt.data.gain);
          break;
        }
        case 'setSmoothingCoefficient': {
          if (!this.wasmInstance) {
            return;
          }
          this.wasmInstance.exports.set_smoothing_coefficient(evt.data.smoothingCoefficient);
          if (evt.data.smoothingCoefficient === 0) {
            this.wasmInstance.exports.set_quantization_factor(evt.data.quantizationFactor);
          } else {
            this.wasmInstance.exports.set_quantization_factor(0);
          }
          break;
        }
        case 'setQuantizationFactor': {
          if (!this.wasmInstance) {
            return;
          }
          this.wasmInstance.exports.set_quantization_factor(evt.data.quantizationFactor);
          break;
        }
        case 'setNoiseType': {
          if (!this.wasmInstance) {
            return;
          }
          this.wasmInstance.exports.set_noise_type(evt.data.noiseType, evt.data.updateFreqSamples);
          break;
        }
        default: {
          console.warn('Unhandled message type in noisegen AWP: ', evt.data.type);
        }
      }
    };
  }

  async initWasm(wasmBytes) {
    const importObject = { env: {} };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
  }

  process(_inputs, outputs, _params) {
    if (!outputs[0]?.[0] || !this.wasmInstance) {
      return true;
    }

    const ptr = this.wasmInstance.exports.generate();
    const outputsSlice = this.wasmMemoryBuffer.subarray(
      ptr / BYTES_PER_F32,
      ptr / BYTES_PER_F32 + FRAME_SIZE
    );
    outputs[0][0].set(outputsSlice);

    return true;
  }
}

registerProcessor('noise-generator-audio-worklet-node-processor', NoiseGeneratorWorkletProcessor);
