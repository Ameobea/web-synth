const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;

const MAX_SAMPLE_COUNT = 8;

const PARAM_DESCRIPTORS = new Array(MAX_SAMPLE_COUNT).fill(null).flatMap((_, i) => [
  {
    name: `sample_${i}_gate`,
    defaultValue: 0,
    automationRate: 'a-rate',
  },
  {
    name: `sample_${i}_gain`,
    defaultValue: 0,
    minValue: 0,
    maxValue: 10,
    automationRate: 'k-rate',
  },
]);

class SamplePlayerAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAM_DESCRIPTORS;
  }

  constructor() {
    super();

    this.isShutdown = false;
    this.ctxPtr = 0;
    this.wasmInstance = null;
    this.activeSampleCount = 0;
    this.outputBufPtr = 0;
    this.pendingMessages = [];
    this.gainParamsBufferOffset = 0;
    this.gateParamsBufferOffset = 0;
    this.gateParamNames = new Array(MAX_SAMPLE_COUNT).fill(null).map((_, i) => `sample_${i}_gate`);
    this.gainParamNames = new Array(MAX_SAMPLE_COUNT).fill(null).map((_, i) => `sample_${i}_gain`);

    this.port.onmessage = evt => this.handleMessage(evt.data);
  }

  async initWasmInstance(wasmBytes, initialSampleDescriptors) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, { env: {} });

    this.ctxPtr = this.wasmInstance.exports.init_sample_player_ctx();
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    this.outputBufPtr = this.wasmInstance.exports.get_output_buffer_ptr(this.ctxPtr);

    initialSampleDescriptors.forEach((sampleDescriptor, i) => {
      this.addSample(sampleDescriptor.gain);
      if (sampleDescriptor.sampleData) {
        this.setSampleData(i, sampleDescriptor.sampleData);
      }
    });

    this.gainParamsBufferOffset =
      this.wasmInstance.exports.get_gain_params_ptr(this.ctxPtr) / BYTES_PER_F32;
    this.gateParamsBufferOffset =
      this.wasmInstance.exports.get_gate_params_ptr(this.ctxPtr) / BYTES_PER_F32;

    this.pendingMessages.forEach(msg => this.handleMessage(msg));
    this.pendingMessages = [];
  }

  addSample(gain) {
    if (this.activeSampleCount >= MAX_SAMPLE_COUNT) {
      throw new Error(
        'Tried to add more samples than max to sample player AWP; should have been prevented in the UI'
      );
    }

    this.activeSampleCount += 1;
    if (this.activeSampleCount > MAX_SAMPLE_COUNT) {
      throw new Error('Bad active sample accounting');
    }
    this.wasmInstance.exports.add_sample(this.ctxPtr, gain ?? 0);
  }

  removeSample(voiceIx) {
    if (voiceIx >= this.activeSampleCount) {
      throw new Error(
        `Tried to remove sample at index=${voiceIx} that is not in range of cur active sample count=${this.activeSampleCount}`
      );
    }

    this.activeSampleCount -= 1;
    if (this.activeSampleCount < 0) {
      throw new Error('Bad active sample accounting');
    }
    this.wasmInstance.exports.remove_sample(this.ctxPtr, voiceIx);
  }

  setSampleData(voiceIx, sampleData) {
    const sampleBufPtr = this.wasmInstance.exports.get_sample_buf_ptr(
      this.ctxPtr,
      voiceIx,
      sampleData.length
    );
    const buf = this.getWasmMemoryBuffer().subarray(
      sampleBufPtr / BYTES_PER_F32,
      sampleBufPtr / BYTES_PER_F32 + sampleData.length
    );
    buf.set(sampleData);
    this.wasmInstance.exports.on_sample_data_set(this.ctxPtr, voiceIx);
  }

  setSampleCrossfadeParams(voiceIx, enabled, threshold) {
    this.wasmInstance.exports.set_sample_crossfade_params(this.ctxPtr, voiceIx, enabled, threshold);
  }

  handleMessage(data) {
    // Store all events other than the initialization event until after Wasm is loaded and they can be handled.
    //
    // Pending events will be processed once that initialization is finished.
    if (!this.ctxPtr && data.type !== 'setWasmBytes') {
      this.pendingMessages.push(data);
      return;
    }

    switch (data.type) {
      case 'setWasmBytes': {
        this.initWasmInstance(data.wasmBytes, data.initialSampleDescriptors);
        break;
      }
      case 'shutdown': {
        this.isShutdown = true;
        break;
      }
      case 'addSample': {
        this.addSample(data.sample);
        break;
      }
      case 'removeSample': {
        this.removeSample(data.voiceIx);
        break;
      }
      case 'setSampleData': {
        this.setSampleData(data.voiceIx, data.sampleData);
        break;
      }
      case 'setSampleCrossfadeParams': {
        this.setSampleCrossfadeParams(data.voiceIx, data.enabled, data.threshold);
        break;
      }
      default: {
        console.error('Unhandled message type in sample player AWP: ', data.type);
      }
    }
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  process(inputs, outputs, params) {
    if (this.isShutdown) {
      return false;
    } else if (!this.ctxPtr) {
      return true;
    }

    const wasmMemory = this.getWasmMemoryBuffer();

    for (let i = 0; i < this.activeSampleCount; i++) {
      const gainParamName = this.gainParamNames[i];
      const gainParam = params[gainParamName];
      const gateParamName = this.gateParamNames[i];
      const gateParam = params[gateParamName];

      const gainSubarray = wasmMemory.subarray(
        this.gainParamsBufferOffset + FRAME_SIZE * i,
        this.gainParamsBufferOffset + FRAME_SIZE * i + FRAME_SIZE
      );
      if (gainParam.length > 1) {
        gainSubarray.set(gainParam);
      } else {
        gainSubarray.fill(gainParam[0]);
      }

      const gateSubarray = wasmMemory.subarray(
        this.gateParamsBufferOffset + FRAME_SIZE * i,
        this.gateParamsBufferOffset + FRAME_SIZE * i + FRAME_SIZE
      );
      if (gateParam.length > 1) {
        gateSubarray.set(gateParam);
      } else {
        gateSubarray.fill(gateParam[0]);
      }
    }

    this.wasmInstance.exports.process_sample_player(this.ctxPtr);
    const outputSubarray = wasmMemory.subarray(
      this.outputBufPtr / BYTES_PER_F32,
      this.outputBufPtr / BYTES_PER_F32 + FRAME_SIZE
    );

    outputs.forEach(channels => channels.forEach(channel => channel.set(outputSubarray)));

    return true;
  }
}

registerProcessor('sample-player-awp', SamplePlayerAWP);
