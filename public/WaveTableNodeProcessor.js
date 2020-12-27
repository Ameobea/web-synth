const FRAME_SIZE = 128;
const MAX_DIMENSION_COUNT = 2;
const BYTES_PER_F32 = 32 / 8;

class WaveTableNodeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'frequency',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
      {
        name: 'detune',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
      ...Array(MAX_DIMENSION_COUNT)
        .fill(null)
        .map((_, i) => ({
          name: `dimension_${i}_mix`,
          defaultValue: 0.0,
          minValue: 0.0,
          maxValue: 1.0,
          automationRate: 'a-rate',
        })),
      ...Array(MAX_DIMENSION_COUNT - 1)
        .fill(null)
        .map((_, i) => ({
          name: `dimension_${i}x${i + 1}_mix`,
          defaultValue: 0.0,
          minValue: 0.0,
          maxValue: 1.0,
          automationRate: 'a-rate',
        })),
    ];
  }

  async initWasmInstance(data) {
    // const debug = (id, ...args) => console.log(`[${id}]: ${args.join(' ')}`);
    const importObject = {
      env: {},
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
    this.float32WasmMemory.set(data.tableSamples, wavetableDataArrayOffset);

    this.waveTableHandlePtr = this.wasmInstance.exports.init_wavetable_handle(this.waveTablePtr);

    this.dimensionCount = data.dimensionCount;
    const mixesPtr = this.wasmInstance.exports.get_mixes_ptr(this.waveTableHandlePtr, FRAME_SIZE);
    if (mixesPtr % 4 !== 0) {
      throw new Error("Mixes array pointer isn't 4-byte aligned");
    }
    this.mixesArrayOffset = mixesPtr / BYTES_PER_F32;

    const frequencyBufPtr = this.wasmInstance.exports.get_frequencies_ptr(
      this.waveTableHandlePtr,
      FRAME_SIZE
    );
    if (frequencyBufPtr % 4 !== 0) {
      throw new Error("Frequency buffer pointer isn't 4-byte aligned");
    }
    this.frequencyBufArrayOffset = frequencyBufPtr / BYTES_PER_F32;
  }

  constructor() {
    super();

    this.isShutdown = false;
    this.port.onmessage = event => {
      if (event.data === 'shutdown') {
        this.isShutdown = true;
        return;
      }

      this.initWasmInstance(event.data);
    };
  }

  process(_inputs, outputs, params) {
    if (this.isShutdown) {
      return false;
    } else if (!this.waveTableHandlePtr) {
      return true;
    }

    // Write the mixes for each sample in the frame into the Wasm memory.  Mixes are a flattened 3D
    // array of the form `mixes[dimensionIx][interOrIntraIndex][sampleIx]`
    for (let dimensionIx = 0; dimensionIx < this.dimensionCount; dimensionIx++) {
      const intraDimensionalMixVals = params[`dimension_${dimensionIx}_mix`];
      const interDimensionalMixVals =
        dimensionIx > 0 ? params[`dimension_${dimensionIx - 1}x${dimensionIx}_mix`] : null;

      const dstIntraValBaseIx = this.mixesArrayOffset + dimensionIx * FRAME_SIZE * 2;
      if (intraDimensionalMixVals.length === 1) {
        this.float32WasmMemory.fill(
          intraDimensionalMixVals[0],
          dstIntraValBaseIx,
          dstIntraValBaseIx + FRAME_SIZE
        );
      } else if (intraDimensionalMixVals.length === FRAME_SIZE) {
        this.float32WasmMemory.set(intraDimensionalMixVals, dstIntraValBaseIx);
      } else {
        throw new Error(
          'Unexpected size of mix intra dim mix buffer: ',
          intraDimensionalMixVals.length
        );
      }

      if (interDimensionalMixVals !== null) {
        const dstInterValBaseIx = dstIntraValBaseIx + FRAME_SIZE;
        if (interDimensionalMixVals.length === 1) {
          this.float32WasmMemory.fill(
            interDimensionalMixVals[0],
            dstInterValBaseIx,
            dstInterValBaseIx + FRAME_SIZE
          );
        } else if (interDimensionalMixVals.length === FRAME_SIZE) {
          this.float32WasmMemory.set(interDimensionalMixVals, dstInterValBaseIx);
        } else {
          throw new Error(
            'Unexpected size of mix inter dim mix buffer: ',
            interDimensionalMixVals.length
          );
        }
      }
    }

    // Write the frequencies for each sample into Wasm memory
    if (params.frequency.length === 1 && params.detune.length === 1) {
      const realFreq = params.frequency[0] + params.detune[0];
      this.float32WasmMemory.fill(
        realFreq,
        this.frequencyBufArrayOffset,
        this.frequencyBufArrayOffset + FRAME_SIZE
      );
    } else {
      for (let i = 0; i < FRAME_SIZE; i++) {
        this.float32WasmMemory[this.frequencyBufArrayOffset + i] =
          params.frequency[Math.min(params.frequency.length - 1, i)] +
          params.detune[Math.min(params.detune.length - 1, i)];
      }
    }

    // TODO: No need to do this every frame; do once when handle is created and store ptr
    // Sample the wave table for each sample in the frame
    const generatedSamplesPtr = this.wasmInstance.exports.get_samples(
      this.waveTableHandlePtr,
      FRAME_SIZE
    );

    const generatedSamplesArrayOffset = generatedSamplesPtr / BYTES_PER_F32;
    const samplesSlice = this.float32WasmMemory.subarray(
      generatedSamplesArrayOffset,
      generatedSamplesArrayOffset + FRAME_SIZE
    );

    // Copy the generated samples out of Wasm memory into all output buffers
    for (let outputIx = 0; outputIx < outputs.length; outputIx++) {
      for (let channelIx = 0; channelIx < outputs[outputIx].length; channelIx++) {
        outputs[outputIx][channelIx].set(samplesSlice);
      }
    }

    return true;
  }
}

registerProcessor('wavetable-node-processor', WaveTableNodeProcessor);
