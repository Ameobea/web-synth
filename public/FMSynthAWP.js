const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;
const OUTPUT_BYTES_PER_OPERATOR = FRAME_SIZE * BYTES_PER_F32;
const VOICE_COUNT = 10;
const PARAM_COUNT = 8;
const SAMPLE_RATE = 44_100;
const ADSR_PHASE_BUF_LENGTH = 256;

const BASE_FREQUENCY_PARAM_NAMES = new Array(VOICE_COUNT);
for (let i = 0; i < VOICE_COUNT; i++) {
  BASE_FREQUENCY_PARAM_NAMES[i] = `voice_${i}_base_frequency`;
}

class FMSynthAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      ...new Array(VOICE_COUNT).fill(null).map((_x, i) => ({
        name: `voice_${i}_base_frequency`,
        defaultValue: 0,
        automationRate: 'a-rate',
        minValue: 0,
        maxValue: SAMPLE_RATE / 2,
      })),
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
          this.initWasm(
            evt.data.wasmBytes,
            evt.data.modulationMatrix,
            evt.data.outputWeights,
            evt.data.adsrs
          );
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
            evt.data.valParamFloat,
            evt.data.valParamFloat2
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
            evt.data.valParamFloat,
            evt.data.valParamFloat2
          );
          break;
        }
        case 'setOperatorConfig': {
          if (!this.wasmInstance) {
            console.error('Tried setting operator config before Wasm instance loaded');
            return;
          }
          this.wasmInstance.exports.fm_synth_set_operator_config(
            this.ctxPtr,
            evt.data.operatorIx,
            evt.data.operatorType,
            evt.data.valueType,
            evt.data.valParamInt,
            evt.data.valParamFloat,
            evt.data.valParamFloat2
          );
          break;
        }
        case 'setOperatorBaseFrequencySource': {
          if (!this.wasmInstance) {
            console.error('Tried setting output weight before Wasm instance loaded');
            return;
          }
          this.wasmInstance.exports.fm_synth_set_operator_base_frequency_source(
            this.ctxPtr,
            evt.data.operatorIx,
            evt.data.valueType,
            evt.data.valParamInt,
            evt.data.valParamFloat,
            evt.data.valParamFloat2
          );
          break;
        }
        case 'setEffect': {
          if (!this.wasmInstance) {
            console.error('Tried setting effect value before Wasm instance loaded');
            return;
          }

          const { effectType, param1, param2, param3, param4, isBypassed } = evt.data;
          this.wasmInstance.exports.fm_synth_set_effect(
            this.ctxPtr,
            evt.data.operatorIx ?? -1,
            evt.data.effectIx,
            effectType,
            param1?.valueType ?? 0,
            param1?.valParamInt ?? 0,
            param1?.valParamFloat ?? 0,
            param1?.valParamFloat2 ?? 0,
            param2?.valueType ?? 0,
            param2?.valParamInt ?? 0,
            param2?.valParamFloat ?? 0,
            param2?.valParamFloat2 ?? 0,
            param3?.valueType ?? 0,
            param3?.valParamInt ?? 0,
            param3?.valParamFloat ?? 0,
            param3?.valParamFloat2 ?? 0,
            param4?.valueType ?? 0,
            param4?.valParamInt ?? 0,
            param4?.valParamFloat ?? 0,
            param4?.valParamFloat2 ?? 0,
            isBypassed ?? false
          );
          break;
        }
        case 'setAdsr': {
          if (!this.wasmInstance) {
            console.error('Tried setting adsr value before Wasm instance loaded');
            return;
          }

          const { adsrIx, steps, lenSamples, releasePoint, loopPoint } = evt.data;
          steps.forEach(({ x, y, ramper, param }, stepIx) => {
            this.wasmInstance.exports.set_adsr_step_buffer(stepIx, x, y, ramper, param);
          });
          this.wasmInstance.exports.set_adsr(
            this.ctxPtr,
            adsrIx,
            steps.length,
            lenSamples,
            releasePoint,
            loopPoint ?? -1.0
          );
          break;
        }
        case 'setAdsrLength': {
          if (!this.wasmInstance) {
            console.error('Tried setting adsr length before Wasm instance loaded');
            return;
          }
          this.wasmInstance.exports.set_adsr_length(
            this.ctxPtr,
            evt.data.adsrIx,
            evt.data.lenSamples
          );

          break;
        }
        case 'gate': {
          if (!this.wasmInstance) {
            console.warn('Tried gating before Wasm instance loaded');
            return;
          }

          this.wasmInstance.exports.gate_voice(this.ctxPtr, evt.data.voiceIx);
          break;
        }
        case 'ungate': {
          if (!this.wasmInstance) {
            console.warn('Tried ungating before Wasm instance loaded');
            return;
          }

          this.wasmInstance.exports.ungate_voice(this.ctxPtr, evt.data.voiceIx);
          break;
        }
        case 'setDetune': {
          if (!this.wasmInstance) {
            console.warn('Tried ungating before Wasm instance loaded');
            return;
          }

          this.wasmInstance.exports.fm_synth_set_detune(
            this.ctxPtr,
            evt.data.valueType ?? 0,
            evt.data.valParamInt ?? 0,
            evt.data.valParamFloat ?? 0,
            evt.data.valParamFloat2 ?? 0
          );
          break;
        }
        case 'midiControlValue': {
          if (!this.wasmInstance) {
            console.warn('Tried to set MIDI control value before Wasm instance loaded');
            return;
          }

          this.wasmInstance.exports.fm_synth_set_midi_control_value(
            evt.data.controlIndex,
            evt.data.controlValue
          );
          break;
        }
        default: {
          console.warn('Unhandled message type in FM Synth AWP: ', evt.data.type);
        }
      }
    };
  }

  async initWasm(wasmBytes, modulationMatrix, outputWeights, adsrs) {
    const importObject = { env: { debug1: (...args) => console.log(...args) } };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    this.wasmInstance.exports.memory.grow(1024 * 4);
    this.ctxPtr = this.wasmInstance.exports.init_fm_synth_ctx(VOICE_COUNT);
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    this.tacentVoiceFlags = new Uint8Array(VOICE_COUNT);

    outputWeights.forEach((paramSource, operatorIx) =>
      this.wasmInstance.exports.fm_synth_set_output_weight_value(
        this.ctxPtr,
        operatorIx,
        paramSource.valueType,
        paramSource.valParamInt,
        paramSource.valParamFloat,
        paramSource.valParamFloat2
      )
    );
    adsrs.forEach(({ steps, lenSamples, releasePoint, loopPoint }, adsrIx) => {
      steps.forEach(({ x, y, ramper, param }, stepIx) => {
        this.wasmInstance.exports.set_adsr_step_buffer(stepIx, x, y, ramper, param);
      });
      this.wasmInstance.exports.set_adsr(
        this.ctxPtr,
        adsrIx,
        steps.length,
        lenSamples,
        releasePoint,
        loopPoint ?? -1.0
      );
    });
    modulationMatrix.forEach((indices, srcOperatorIx) =>
      indices.forEach((paramSource, dstOperatorIx) =>
        this.wasmInstance.exports.fm_synth_set_modulation_index(
          this.ctxPtr,
          srcOperatorIx,
          dstOperatorIx,
          paramSource.valueType,
          paramSource.valParamInt,
          paramSource.valParamFloat,
          paramSource.valParamFloat2
        )
      )
    );

    if (typeof SharedArrayBuffer !== 'undefined') {
      this.audioThreadDataBufferInner = new SharedArrayBuffer(
        ADSR_PHASE_BUF_LENGTH * BYTES_PER_F32
      );
      this.audioThreadDataBuffer = new Float32Array(this.audioThreadDataBufferInner);
      this.adsrPhasesBufPtr = this.wasmInstance.exports.get_adsr_phases_buf_ptr(this.ctxPtr);
    } else {
      this.audioThreadDataBuffer = new Float32Array(1);
    }

    this.port.postMessage({
      type: 'wasmInitialized',
      audioThreadDataBuffer: this.audioThreadDataBufferInner,
    });
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
      const param = params[BASE_FREQUENCY_PARAM_NAMES[voiceIx]];
      const voiceIsTacent = param.length === 0 && param[0] === 0;
      if (voiceIsTacent && this.tacentVoiceFlags[voiceIx] === 1) {
        continue;
      }
      this.tacentVoiceFlags[voiceIx] = voiceIsTacent ? 1 : 0;
      const ptrForVoice = baseFrequencyInputBufPtr + FRAME_SIZE * BYTES_PER_F32 * voiceIx;

      if (param.length === 1) {
        wasmMemory.fill(param[0], ptrForVoice / 4, (ptrForVoice + FRAME_SIZE * BYTES_PER_F32) / 4);
      } else {
        wasmMemory.set(param, ptrForVoice / 4);
      }
    }
    const paramBuffersPtr = this.wasmInstance.exports.get_param_buffers_ptr(this.ctxPtr);
    // TODO: Store active param count somewhere to avoid unnecessary memcopies
    for (let paramIx = 0; paramIx < PARAM_COUNT; paramIx++) {
      const param = params[paramIx];
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
    for (let voiceIx = 0; voiceIx < VOICE_COUNT; voiceIx++) {
      const voiceIsTacent = this.tacentVoiceFlags[voiceIx];
      if (voiceIsTacent) {
        outputs[voiceIx]?.[0]?.fill(0);
        continue;
      }

      const outputSlice = wasmMemory.subarray(
        (outputsPtr + voiceIx * OUTPUT_BYTES_PER_OPERATOR) / 4,
        (outputsPtr + voiceIx * OUTPUT_BYTES_PER_OPERATOR + OUTPUT_BYTES_PER_OPERATOR) / 4
      );
      outputs[voiceIx]?.[0]?.set(outputSlice);
    }

    // Copy current ADSR phases to shared buffer
    if (this.audioThreadDataBuffer && this.adsrPhasesBufPtr) {
      const adsrPhaseBuf = wasmMemory.subarray(
        this.adsrPhasesBufPtr / BYTES_PER_F32,
        this.adsrPhasesBufPtr / BYTES_PER_F32 + ADSR_PHASE_BUF_LENGTH
      );
      this.audioThreadDataBuffer.set(adsrPhaseBuf);
    }

    return true;
  }
}

registerProcessor('fm-synth-audio-worklet-processor', FMSynthAWP);
