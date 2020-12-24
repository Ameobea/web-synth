const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;
const OPERATOR_COUNT = 8;
const OUTPUT_BYTES_PER_OPERATOR = FRAME_SIZE * BYTES_PER_F32;
const VOICE_COUNT = 8;
const PARAM_COUNT = 8;

class NoiseGeneratorWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'base_frequency',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
      ...new Array(PARAM_COUNT).fill(null).map((_x, i) => ({
        name: i.toString(),
        defaultValue: 0,
        automationRate: 'a-rate',
      })),
    ];
  }

  constructor() {
    super();

    this.wasmInstance = null;
    this.ctxPtr = 0;
    this.wasmMemoryBuffer = null;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          this.initWasm(evt.data.wasmBytes, evt.data.modulationIndices, evt.data.outputWeights);
          break;
        }
        case 'setModulationIndex': {
          if (!this.wasmInstance) {
            console.error('Tried setting modulation index before Wasm instance loaded');
            return;
          }
          this.wasmInstance.exports.fm_synth_set_modulation_index(
            this.ctxPtr,
            evt.data.srcOperatorIx,
            evt.data.dstOperatorIx,
            evt.data.valueType,
            evt.data.valParamInt,
            evt.data.valParamFloat
          );
          break;
        }
        case 'setOutputWeightValue': {
          if (!this.wasmInstance) {
            console.error('Tried setting output weight value before Wasm instance loaded');
            return;
          }
          this.wasmInstance.exports.fm_synth_set_output_weight_value(
            this.ctxPtr,
            evt.data.operatorIx,
            evt.data.valueType,
            evt.data.valParamInt,
            evt.data.valParamFloat
          );
          break;
        }
        case 'setOperatorBaseFrequencySource': {
          if (!this.wasmInstance) {
            console.error('Tried setting output weight value before Wasm instance loaded');
            return;
          }
          this.wasmInstance.exports.fm_synth_set_operator_base_frequency_source(
            this.ctxPtr,
            evt.data.operatorIx,
            evt.data.valueType,
            evt.data.valParamInt,
            evt.data.valParamFloat
          );
          break;
        }
        default: {
          console.warn('Unhandled message type in FM Synth AWP: ', evt.data.type);
        }
      }
    };
  }

  async initWasm(wasmBytes, modulationIndices, outputWeights) {
    const importObject = { env: {} };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    this.ctxPtr = this.wasmInstance.exports.init_fm_synth_ctx(VOICE_COUNT);
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);

    modulationIndices.forEach((indices, srcOperatorIx) =>
      indices.forEach((modulationIndex, dstOperatorIx) =>
        this.wasmInstance.exports.fm_synth_set_modulation_index(
          this.ctxPtr,
          srcOperatorIx,
          dstOperatorIx,
          1,
          0,
          modulationIndex
        )
      )
    );
    outputWeights.forEach((weight, operatorIx) =>
      this.wasmInstance.exports.fm_synth_set_output_weight_value(
        this.ctxPtr,
        operatorIx,
        1,
        0,
        weight
      )
    );

    this.port.postMessage({ type: 'wasmInitialized' });
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  process(_inputs, outputs, params) {
    if (!this.wasmInstance) {
      return true;
    }

    let wasmMemory = this.getWasmMemoryBuffer();
    const baseFrequencyInputBufPtr = this.wasmInstance.exports.get_base_frequency_input_buffer_ptr(
      this.ctxPtr
    );
    for (let voiceIx = 0; voiceIx < VOICE_COUNT; voiceIx++) {
      const param = params.base_frequency;

      if (param.length === 1) {
        wasmMemory.fill(
          param[0],
          baseFrequencyInputBufPtr / 4,
          (baseFrequencyInputBufPtr + FRAME_SIZE * BYTES_PER_F32) / 4
        );
      } else {
        wasmMemory.set(param, baseFrequencyInputBufPtr / 4);
      }
    }
    const paramBuffersPtr = this.wasmInstance.exports.get_param_buffers_ptr(this.ctxPtr);
    // TODO: Store active param count somewhere to avoid unnecessary memcopies
    for (let paramIx = 0; paramIx < PARAM_COUNT; paramIx++) {
      const param = params[paramIx.toString()];
      const bufPtrForVoice = paramBuffersPtr + OUTPUT_BYTES_PER_OPERATOR * paramIx;

      if (param.length === 1) {
        wasmMemory.fill(
          param[0],
          bufPtrForVoice / 4,
          (bufPtrForVoice + FRAME_SIZE * BYTES_PER_F32) / 4
        );
      } else {
        wasmMemory.set(param, bufPtrForVoice / 4);
      }
    }

    const outputsPtr = this.wasmInstance.exports.fm_synth_generate(this.ctxPtr);
    wasmMemory = this.getWasmMemoryBuffer();
    for (let opIx = 0; opIx < OPERATOR_COUNT; opIx++) {
      const outputSlice = wasmMemory.slice(
        (outputsPtr + opIx * OUTPUT_BYTES_PER_OPERATOR) / 4,
        (outputsPtr + opIx * OUTPUT_BYTES_PER_OPERATOR + OUTPUT_BYTES_PER_OPERATOR) / 4
      );
      outputs[opIx]?.[0]?.set(outputSlice);
    }

    return true;
  }
}

registerProcessor('fm-synth-audio-worklet-processor', NoiseGeneratorWorkletProcessor);
