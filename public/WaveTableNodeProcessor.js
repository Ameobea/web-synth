const FRAME_SIZE = 128;
const MAX_DIMENSION_COUNT = 16;
const BYTES_PER_F32 = 32 / 8;

class WaveTableNodeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return Array(MAX_DIMENSION_COUNT)
      .fill(null)
      .map((_, i) => ({
        name: `mix_${i}`,
        defaultValue: 0.0,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: 'a-rate',
      }));
  }

  async initWasmInstance(data) {
    const compiledModule = await WebAssembly.compile(data.arrayBuffer);
    this.wasmInstance = new WebAssembly.Instance(compiledModule, {});

    this.waveTablePtr = this.wasmInstance.exports.init_wavetable(
      data.waveformsPerDimension,
      data.dimensionCount,
      data.waveformLength,
      data.baseFrequency,
      data.tableSamples
    );
    this.waveTableHandlePtr = this.wasmInstance.exports.init_wavetable_handle(this.waveTablePtr);

    this.dimensionCount = data.dimensionCount;
    const mixesPtr = this.wasmInstance.exports.get_mixes_ptr(this.waveTableHandlePtr, FRAME_SIZE);
    // Hope it's aligned...
    this.mixesArrayOffset = mixesPtr / BYTES_PER_F32;
    this.float32WasmMemory = new Float32Array(this.wasmInstance.exports.memory.buffer);
  }

  constructor() {
    super();

    this.port.onmessage = event => this.initWasmInstance(event.data);
  }

  process(inputs, outputs, params) {
    if (!this.waveTableHandlePtr) {
      return;
    }

    // Write the mixes for each sample in the frame into the Wasm memory
    for (let sampleIx = 0; sampleIx < FRAME_SIZE; sampleIx++) {
      for (let dimensionIx = 0; dimensionIx < this.dimensionCount; dimensionIx++) {
        const ix = this.mixesArrayOffset + sampleIx * this.dimensionCount + dimensionIx;
        this.float32WasmMemory[ix] = params[`mix_${dimensionIx}`][sampleIx];
      }
    }

    // Sample the wave table for each sample in the frame
    const generatedSamplesPtr = this.wasmInstance.exports.get_samples(
      this.waveTableHandlePtr,
      FRAME_SIZE
    );
    // Hope again that it's 32-bit aligned
    const generatedSamplesArrayOffset = generatedSamplesPtr / BYTES_PER_F32;

    // Copy the generated samples out of Wasm memory into all output buffers
    for (let outputIx = 0; outputIx < outputs.length; outputIx++) {
      for (let channelIx = 0; channelIx < outputs[i].length; channelIx++) {
        for (let sampleIx = 0; sampleIx < FRAME_SIZE; sampleIx++) {
          const sample = this.float32WasmMemory[generatedSamplesArrayOffset + sampleIx];
          outputs[outputIx][channelIx][sampleIx] = sample;
        }
      }
    }
  }
}

registerProcessor('wavetable-node-processor', WaveTableNodeProcessor);
