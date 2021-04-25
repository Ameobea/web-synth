const clamp = (min, max, val) => Math.min(Math.max(min, val), max);

const BYTES_PER_F32 = 4;
const FRAME_SIZE = 128;
const RECORDING_BLOCK_SIZE = 44100 / 3; // 3 blocks/second

class GranulatorWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'start_sample',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'end_sample',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'grain_size',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'voice_1_samples_between_grains',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'voice_2_samples_between_grains',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'sample_speed_ratio',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'voice_1_filter_cutoff',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'voice_2_filter_cutoff',
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'linear_slope_length',
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
      {
        name: 'slope_linearity',
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
      {
        name: 'voice_1_movement_samples_per_sample',
        defaultValue: 0,
        minValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'voice_2_movement_samples_per_sample',
        defaultValue: 0,
        minValue: 0,
        automationRate: 'k-rate',
      },
    ];
  }

  async initWasm(wasmBytes) {
    const importObject = { env: {} };

    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    if (this.samples) {
      this.initGranularCtx();
    }
    // We'll set the samples when we receive them if we haven't already

    this.wasmMemory = new Float32Array(this.wasmInstance.exports.memory.buffer);
  }

  initGranularCtx() {
    this.granularInstCtxPtr = this.wasmInstance.exports.create_granular_instance();
    const waveformPtr = this.wasmInstance.exports.get_granular_waveform_ptr(
      this.granularInstCtxPtr,
      this.samples.length
    );
    new Float32Array(this.wasmInstance.exports.memory.buffer).set(
      this.samples,
      waveformPtr / BYTES_PER_F32
    );
  }

  constructor() {
    super();

    this.samples = null;
    this.i = 0;
    this.isRecording = false;
    this.isShutdown = false;
    // Pointer to the recording context in Wasm memory
    this.sampleRecorderCtxPtr = 0;
    // Number of samples that have been recorded since a block of samples was sent to the main thread
    this.recordedSamplesSinceLastReported = 0;
    // Index of the current recording block, used to order them on the UI thread
    this.recordingBlockIndex = 0;
    // The absolute index of the last sample sent to the main thread; next recording block should start here.
    this.lastSentRecordingBlockEndIx = 0;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setSamples': {
          this.samples = evt.data.samples;
          if (this.wasmInstance && this.samples) {
            this.initGranularCtx();
          }
          break;
        }
        case 'setWasmBytes': {
          this.initWasm(evt.data.wasmBytes);
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        case 'startRecording': {
          this.isRecording = true;
          this.recordedSamplesSinceLastReported = 0;
          this.recordingBlockIndex = 0;
          this.lastSentRecordingBlockEndIx = 0;
          if (this.sampleRecorderCtxPtr) {
            this.wasmInstance.exports.free_sample_recording_ctx(this.sampleRecorderCtxPtr);
          }
          this.sampleRecorderCtxPtr = this.wasmInstance.exports.create_sample_recorder_ctx();
          break;
        }
        case 'stopRecording': {
          // Send one final block of all remaining samples
          this.sendRecordingBlock();
          this.isRecording = false;
          break;
        }
        case 'exportRecording': {
          this.exportRecording(evt.data.format, evt.data.startSampleIx, evt.data.endSampleIx);
          break;
        }
        default: {
          console.warn('Unhandled msg event type in granulator AWP: ', evt.data.type);
        }
      }
    };
  }

  exportRecording(format, startSampleIx, endSampleIx) {
    if (!this.wasmInstance || !this.sampleRecorderCtxPtr) {
      console.error('Tried to export recording w/o wasm instance and/or recording ctx');
      return;
    } else if (typeof startSampleIx !== 'number' || typeof endSampleIx !== 'number') {
      console.error(
        'Missing or invalid start and/or end sample index when encoding sample; expecting numbers'
      );
      return;
    } else if (typeof format !== 'number') {
      console.error('Missing or invalid format provided when encoding sample; expected number');
      return;
    }

    const encodedLengthBytes = this.wasmInstance.exports.sample_recorder_encode(
      this.sampleRecorderCtxPtr,
      format,
      startSampleIx,
      endSampleIx
    );
    const encodedOutputPtr = this.wasmInstance.exports.sample_recorder_get_encoded_output_ptr(
      this.sampleRecorderCtxPtr
    );
    const encoded = this.wasmInstance.exports.memory.buffer.slice(
      encodedOutputPtr,
      encodedOutputPtr + encodedLengthBytes
    );
    console.log('Successfully encoded recording; posting to port...');
    this.port.postMessage({ type: 'encodedRecording', encoded });
  }

  getWasmMemory() {
    if (this.wasmMemory.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemory = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemory;
  }

  sendRecordingBlock() {
    const blockStartPtr = this.wasmInstance.exports.sample_recorder_get_samples_ptr(
      this.sampleRecorderCtxPtr,
      this.lastSentRecordingBlockEndIx
    );

    const wasmMemory = this.getWasmMemory();
    const block = wasmMemory.slice(
      blockStartPtr / BYTES_PER_F32,
      blockStartPtr / BYTES_PER_F32 + this.recordedSamplesSinceLastReported
    );

    this.port.postMessage({
      type: 'recordingBlock',
      block,
      index: this.recordingBlockIndex,
    });

    this.lastSentRecordingBlockEndIx += this.recordedSamplesSinceLastReported;
    this.recordedSamplesSinceLastReported = 0;
    this.recordingBlockIndex += 1;
  }

  updateRecording(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) {
      return;
    }
    this.recordedSamplesSinceLastReported += samples.length;

    // Copy the samples into the Wasm buffer which holds the main recording
    const ptr = this.wasmInstance.exports.sample_recorder_record(
      this.sampleRecorderCtxPtr,
      samples.length
    );
    const wasmMemory = this.getWasmMemory();
    wasmMemory.set(samples, ptr / BYTES_PER_F32);

    // If we've written enough samples to warrant a new chunk of them being sent to the main thread,
    // do so and update our counters accordingly
    if (this.recordedSamplesSinceLastReported > RECORDING_BLOCK_SIZE) {
      this.sendRecordingBlock();
    }
  }

  process(inputs, outputs, params) {
    if (this.isShutdown) {
      return false;
    }

    if (this.isRecording) {
      this.updateRecording(inputs);
    }

    if (outputs.length === 0 || !this.samples || !this.wasmInstance || !this.granularInstCtxPtr) {
      return true;
    } else if (outputs[0].length === 0) {
      throw new Error('Output 0 must have at least one channel for impl detail reasons');
    }

    const selectionStartSampleIx = clamp(0, this.samples.length, params['start_sample'][0]);
    const selectionEndSampleIx = clamp(
      selectionStartSampleIx,
      this.samples.length,
      params['end_sample'][0]
    );
    if (selectionEndSampleIx <= selectionStartSampleIx) {
      return true;
    }

    const grainSize = params['grain_size'][0];
    const voice1SamplesBetweenGrains = params['voice_1_samples_between_grains'][0];
    const voice2SamplesBetweenGrains = params['voice_2_samples_between_grains'][0];
    const sampleSpeedRatio = params['sample_speed_ratio'][0];
    const voice1FilterCutoff = params['voice_1_filter_cutoff'][0];
    const voice2FilterCutoff = params['voice_2_filter_cutoff'][0];
    const linearSlopeLength = params['linear_slope_length'][0];
    const slopeLinearity = params['slope_linearity'][0];
    const voice1MovementSamplesPerSample = params['voice_1_movement_samples_per_sample'][0];
    const voice2MovementSamplesPerSample = params['voice_2_movement_samples_per_sample'][0];

    // Render
    const outputBufPtr = this.wasmInstance.exports.render_granular(
      this.granularInstCtxPtr,
      selectionStartSampleIx,
      selectionEndSampleIx,
      grainSize,
      voice1FilterCutoff,
      voice2FilterCutoff,
      linearSlopeLength,
      slopeLinearity,
      voice1MovementSamplesPerSample,
      voice2MovementSamplesPerSample,
      sampleSpeedRatio,
      sampleSpeedRatio, // TODO: separate per voice
      voice1SamplesBetweenGrains,
      voice2SamplesBetweenGrains
    );

    // Fill the first output buffer and then copy them to all other outputs
    const dstBuffer = outputs[0][0];
    const output = new Float32Array(this.wasmInstance.exports.memory.buffer).subarray(
      outputBufPtr / BYTES_PER_F32,
      outputBufPtr / BYTES_PER_F32 + FRAME_SIZE
    );
    dstBuffer.set(output);

    for (let outputIx = 0; outputIx < outputs.length; outputIx++) {
      for (let channelIx = 0; channelIx < outputs[outputIx].length; channelIx++) {
        if (outputIx === 0 && channelIx === 0) {
          continue;
        }

        outputs[outputIx][channelIx].set(dstBuffer);
      }
    }

    return true;
  }
}

registerProcessor('granulator-audio-worklet-processor', GranulatorWorkletProcessor);
