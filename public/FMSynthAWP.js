const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;
const OPERATOR_COUNT = 8;
const OUTPUT_BYTES_PER_OPERATOR = FRAME_SIZE * BYTES_PER_F32;
const VOICE_COUNT = 8;

class NoiseGeneratorWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      ...new Array(VOICE_COUNT).fill(null).map((_x, i) => ({
        name: 'voice_' + i + '_frequency',
        defaultValue: 220, // TODO TODO CHANGE TO 0
        automationRate: 'a-rate',
      })),
    ]; // TODO
  }

  constructor() {
    super();

    this.wasmInstance = null;
    this.ctxPtr = 0;
    this.wasmMemoryBuffer = null;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          this.initWasm(evt.data.wasmBytes);
          break;
        }
        case 'setModulationValue': {
          if (!this.wasmInstance) {
            console.error('Tried setting modulation value before Wasm instance loaded');
            return;
          }
          this.wasmInstance.exports.fm_synth_set_modulation_value(
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
        default: {
          console.warn('Unhandled message type in FM Synth AWP: ', evt.data.type);
        }
      }
    };
  }

  async initWasm(wasmBytes) {
    const importObject = { env: {} };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    this.ctxPtr = this.wasmInstance.exports.init_fm_synth_ctx(VOICE_COUNT);
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
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
    const inputFrequencyBuffersPtr = this.wasmInstance.exports.get_input_frequency_buffers_ptr(
      this.ctxPtr
    );
    for (let voiceIx = 0; voiceIx < VOICE_COUNT; voiceIx++) {
      const param = params[`voice_${voiceIx}_frequency`];
      const bufPtrForVoice = inputFrequencyBuffersPtr + OUTPUT_BYTES_PER_OPERATOR * voiceIx;

      if (param.length === 1) {
        wasmMemory.fill(
          param[0],
          bufPtrForVoice / 4,
          (bufPtrForVoice + OUTPUT_BYTES_PER_OPERATOR) / 4
        );
      } else {
        wasmMemory.set(param, bufPtrForVoice / 4);
      }
    }
    const paramBuffersPtr = this.wasmInstance.exports.get_param_buffers_ptr(this.ctxPtr);
    // TODO: Copy param buffers

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
