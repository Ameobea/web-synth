const FRAME_SIZE = 128;
const MAX_DIMENSION_COUNT = 16;
const BYTES_PER_F32 = 32 / 8;

const clamp = (min, max, val) => Math.min(Math.max(min, val), max);

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
    const debug = (id, ...args) => console.log(`[${id}]: ${args.join(' ')}`);
    const importObject = {
      env: {
        debug1_: debug,
        debug2_: debug,
        debug3_: debug,
        debug4_: debug,
      },
    };

    const compiledModule = await WebAssembly.compile(data.arrayBuffer);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);

    this.waveTablePtr = this.wasmInstance.exports.init_wavetable(
      data.waveformsPerDimension,
      data.dimensionCount,
      data.waveformLength,
      data.baseFrequency
    );

    // Wasm memory doesn't become available until after some function in the Wasm module has been called, apparently,
    // so we wait to set this reference until after calling one of the Wasm functions.
    this.float32WasmMemory = new Float32Array(this.wasmInstance.exports.memory.buffer);

    const wavetableDataPtr = this.wasmInstance.exports.get_data_table_ptr(this.waveTablePtr);
    const wavetableDataArrayOffset = wavetableDataPtr / BYTES_PER_F32;
    if (wavetableDataPtr % 4 !== 0) {
      throw new Error('Wavetable data array pointer is not 32-bit aligned');
    }

    // We set a marker value into the data table on the Wasm side; we check that it matches here to ensure that
    // we've got the correct pointer;
    if (this.float32WasmMemory[wavetableDataArrayOffset] !== -1) {
      throw new Error(
        'Marker value not set at initial wavetable sample data table pointer retrieved from Wasm'
      );
    }

    // Write the table's data into the Wasm heap
    for (let i = 0; i < data.tableSamples.length; i++) {
      this.float32WasmMemory[wavetableDataArrayOffset + i] = data.tableSamples[i];
    }

    this.waveTableHandlePtr = this.wasmInstance.exports.init_wavetable_handle(this.waveTablePtr);

    this.dimensionCount = data.dimensionCount;
    const mixesPtr = this.wasmInstance.exports.get_mixes_ptr(this.waveTableHandlePtr, FRAME_SIZE);
    if (mixesPtr % 4 !== 0) {
      throw new Error("Mixes array pointer isn't 4-byte aligned");
    }
    this.mixesArrayOffset = mixesPtr / BYTES_PER_F32;
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
        const val =
          params[`mix_${dimensionIx}`][Math.min(sampleIx, params[`mix_${dimensionIx}`].length - 1)];
        // Apparently the `minValue` and `maxValue` params don't work, so we have to clamp manually to [0,1]
        this.float32WasmMemory[ix] = clamp(0, 1, val);
      }
    }

    // Sample the wave table for each sample in the frame
    const generatedSamplesPtr = this.wasmInstance.exports.get_samples(
      this.waveTableHandlePtr,
      FRAME_SIZE
    );
    if (generatedSamplesPtr % 4 !== 0) {
      throw new Error("Generated samples pointer isn't 4-byte aligned");
    }
    const generatedSamplesArrayOffset = generatedSamplesPtr / BYTES_PER_F32;

    // Copy the generated samples out of Wasm memory into all output buffers
    for (let outputIx = 0; outputIx < outputs.length; outputIx++) {
      for (let channelIx = 0; channelIx < outputs[outputIx].length; channelIx++) {
        for (let sampleIx = 0; sampleIx < FRAME_SIZE; sampleIx++) {
          const sample = this.float32WasmMemory[generatedSamplesArrayOffset + sampleIx];
          outputs[outputIx][channelIx][sampleIx] = sample;
        }
      }
    }

    return true;
  }
}

registerProcessor('wavetable-node-processor', WaveTableNodeProcessor);
