const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;
const OUTPUT_BYTES_PER_OPERATOR = FRAME_SIZE * BYTES_PER_F32;
const PARAM_COUNT = 8;
const ADSR_PHASE_BUF_LENGTH = 256;

const hashSampleDescriptor = descriptor =>
  `${descriptor.name}${descriptor.isLocal}${descriptor.id}`;

class FMSynthAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      ...new Array(PARAM_COUNT).fill(null).map((_x, i) => ({
        name: i.toString(),
        defaultValue: 0,
        automationRate: 'a-rate',
      })),
      {
        name: 'filter_cutoff_freq',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
      {
        name: 'filter_q',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
      {
        name: 'filter_gain',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
    ];
  }

  constructor({ processorOptions }) {
    super();

    if (processorOptions?.mailboxID) {
      this.mailboxID = processorOptions.mailboxID;
      globalThis.midiEventMailboxRegistry.addMailbox(processorOptions.mailboxID);
    } else {
      this.mailboxID = null;
    }

    this.wasmInstance = null;
    this.lastStateByOperatorIx = null;
    this.shutdown = false;
    this.ctxPtr = 0;
    this.wasmMemoryBuffer = null;
    this.sampleDataIxByHashedSampleDescriptor = new Map();

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          this.initWasm(
            evt.data.wasmBytes,
            evt.data.modulationMatrix,
            evt.data.outputWeights,
            evt.data.adsrs
          );
          this.debugID = evt.data.debugID;
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
            evt.data.valParamFloat2,
            evt.data.valParamFloat3
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
            evt.data.valParamFloat2,
            evt.data.valParamFloat3
          );
          break;
        }
        case 'setOperatorConfig': {
          if (!this.wasmInstance) {
            console.error('Tried setting operator config before Wasm instance loaded');
            return;
          }
          const {
            operatorIx,
            operatorType,
            unison,
            unisonPhaseRandomizationEnabled,
            param1,
            param2,
            param3,
            param4,
            param5,
          } = evt.data;
          this.wasmInstance.exports.fm_synth_set_operator_config(
            this.ctxPtr,
            operatorIx,
            operatorType,
            unison,
            unisonPhaseRandomizationEnabled,
            param1?.valueType ?? 0,
            param1?.valParamInt ?? 0,
            param1?.valParamFloat ?? 0,
            param1?.valParamFloat2 ?? 0,
            param1?.valParamFloat3 ?? 0,
            param2?.valueType ?? 0,
            param2?.valParamInt ?? 0,
            param2?.valParamFloat ?? 0,
            param2?.valParamFloat2 ?? 0,
            param2?.valParamFloat3 ?? 0,
            param3?.valueType ?? 0,
            param3?.valParamInt ?? 0,
            param3?.valParamFloat ?? 0,
            param3?.valParamFloat2 ?? 0,
            param3?.valParamFloat3 ?? 0,
            param4?.valueType ?? 0,
            param4?.valParamInt ?? 0,
            param4?.valParamFloat ?? 0,
            param4?.valParamFloat2 ?? 0,
            param4?.valParamFloat3 ?? 0,
            param5?.valueType ?? 0,
            param5?.valParamInt ?? 0,
            param5?.valParamFloat ?? 0,
            param5?.valParamFloat2 ?? 0,
            param5?.valParamFloat3 ?? 0
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
            evt.data.valParamFloat2,
            evt.data.valParamFloat3
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
            param1?.valParamFloat3 ?? 0,
            param2?.valueType ?? 0,
            param2?.valParamInt ?? 0,
            param2?.valParamFloat ?? 0,
            param2?.valParamFloat2 ?? 0,
            param2?.valParamFloat3 ?? 0,
            param3?.valueType ?? 0,
            param3?.valParamInt ?? 0,
            param3?.valParamFloat ?? 0,
            param3?.valParamFloat2 ?? 0,
            param3?.valParamFloat3 ?? 0,
            param4?.valueType ?? 0,
            param4?.valParamInt ?? 0,
            param4?.valParamFloat ?? 0,
            param4?.valParamFloat2 ?? 0,
            param4?.valParamFloat3 ?? 0,
            isBypassed ?? false
          );
          break;
        }
        case 'setAdsr': {
          if (!this.wasmInstance) {
            console.error('Tried setting adsr value before Wasm instance loaded');
            return;
          }

          const { adsrIx, steps, lenSamples, releasePoint, loopPoint, logScale } = evt.data;
          steps.forEach(({ x, y, ramper, param }, stepIx) => {
            this.wasmInstance.exports.set_adsr_step_buffer(stepIx, x, y, ramper, param);
          });
          this.wasmInstance.exports.set_adsr(
            this.ctxPtr,
            adsrIx,
            steps.length,
            lenSamples.valueType,
            lenSamples.valParamInt,
            lenSamples.valParamFloat,
            lenSamples.valParamFloat2,
            lenSamples.valParamFloat3,
            releasePoint,
            loopPoint ?? -1.0,
            logScale ?? false
          );
          break;
        }
        case 'setAdsrLength': {
          if (!this.wasmInstance) {
            console.error('Tried setting adsr length before Wasm instance loaded');
            return;
          }
          const lenSamples = evt.data.lenSamples;
          this.wasmInstance.exports.set_adsr_length(
            this.ctxPtr,
            evt.data.adsrIx,
            lenSamples.valueType,
            lenSamples.valParamInt,
            lenSamples.valParamFloat,
            lenSamples.valParamFloat2,
            lenSamples.valParamFloat3
          );

          break;
        }
        case 'gate': {
          if (!this.wasmInstance) {
            console.warn('Tried gating before Wasm instance loaded');
            return;
          }

          this.wasmInstance.exports.gate(this.ctxPtr, evt.data.midiNumber);
          break;
        }
        case 'ungate': {
          if (!this.wasmInstance) {
            console.warn('Tried ungating before Wasm instance loaded');
            return;
          }

          this.wasmInstance.exports.ungate(this.ctxPtr, evt.data.midiNumber);
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
            evt.data.valParamFloat2 ?? 0,
            evt.data.valParamFloat3 ?? 0
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
        case 'setWavetableData': {
          if (!this.wasmInstance) {
            console.warn('Tried to set wavetable data before Wasm instance loaded');
            return;
          }

          const { wavetableIx, waveformsPerDimension, waveformLength, baseFrequency, samples } =
            evt.data;
          const wavetableDataPtr = this.wasmInstance.exports.fm_synth_get_wavetable_data_ptr(
            this.ctxPtr,
            wavetableIx,
            waveformsPerDimension,
            waveformLength,
            baseFrequency
          );
          const sampleCount = waveformLength * waveformsPerDimension * 2;
          if (samples.length !== sampleCount && samples.length * 2 !== sampleCount) {
            console.error(
              `Wavetable data length ${samples.length} does not match expected length ${sampleCount}`
            );
            return;
          }
          const dataBuf = this.getWasmMemoryBuffer().subarray(
            wavetableDataPtr / BYTES_PER_F32,
            wavetableDataPtr / BYTES_PER_F32 + sampleCount
          );
          dataBuf.set(samples);
          if (sampleCount === samples.length * 2) {
            dataBuf.set(samples, samples.length);
          }
          break;
        }
        case 'setSampleMappingState': {
          const { stateByOperatorIx } = evt.data.sampleMappingState;
          this.lastStateByOperatorIx = stateByOperatorIx;
          this.setSampleMappingState(stateByOperatorIx);
          break;
        }
        case 'setSample': {
          const { descriptor, data } = evt.data;
          const descriptorHash = hashSampleDescriptor(descriptor);
          if (this.sampleDataIxByHashedSampleDescriptor.has(descriptorHash)) {
            console.warn('Already added sample data with descriptor', descriptor);
            break;
          }
          const sampleDataIx = this.wasmInstance.exports.fm_synth_add_sample(data.length);
          const sampleDataBufPtr =
            this.wasmInstance.exports.fm_synth_get_sample_buf_ptr(sampleDataIx);
          const memory = this.getWasmMemoryBuffer();
          const sampleBuffer = memory.subarray(
            sampleDataBufPtr / BYTES_PER_F32,
            sampleDataBufPtr / BYTES_PER_F32 + data.length
          );
          sampleBuffer.set(data);
          this.sampleDataIxByHashedSampleDescriptor.set(descriptorHash, sampleDataIx);
          if (this.lastStateByOperatorIx) {
            this.setSampleMappingState(this.lastStateByOperatorIx);
          }
          break;
        }
        case 'setFrequencyMultiplier': {
          if (!this.wasmInstance) {
            console.warn('Tried to set frequency multiplier before Wasm instance loaded');
            return;
          }

          this.wasmInstance.exports.fm_synth_set_frequency_multiplier(
            this.ctxPtr,
            evt.data.frequencyMultiplier
          );
          break;
        }
        case 'setFilterBypassed': {
          if (!this.wasmInstance) {
            console.warn('Tried to set filter bypassed before Wasm instance loaded');
            return;
          }

          this.wasmInstance.exports.fm_synth_set_filter_bypassed(this.ctxPtr, evt.data.isBypassed);
          break;
        }
        case 'setFilterType': {
          if (!this.wasmInstance) {
            console.warn('Tried to set filter type before Wasm instance loaded');
            return;
          }

          this.wasmInstance.exports.fm_synth_set_filter_type(this.ctxPtr, evt.data.filterType);
          break;
        }
        case 'setFilterQ': {
          if (!this.wasmInstance) {
            console.warn('Tried to set filter type before Wasm instance loaded');
            return;
          }

          const { Q, controlSource } = evt.data;
          this.wasmInstance.exports.fm_synth_set_filter_q(this.ctxPtr, Q, controlSource);
          break;
        }
        case 'setFilterFrequency': {
          if (!this.wasmInstance) {
            console.warn('Tried to set filter frequency before Wasm instance loaded');
            return;
          }

          const { frequency, controlSource } = evt.data;
          this.wasmInstance.exports.fm_synth_set_filter_cutoff_frequency(
            this.ctxPtr,
            frequency,
            controlSource
          );
          break;
        }
        case 'setFilterGain': {
          if (!this.wasmInstance) {
            console.warn('Tried to set filter gain before Wasm instance loaded');
            return;
          }

          const { gain, controlSource } = evt.data;
          this.wasmInstance.exports.fm_synth_set_filter_gain(this.ctxPtr, gain, controlSource);
          break;
        }
        case 'setMasterGain': {
          if (!this.wasmInstance) {
            console.warn('Tried to set master gain before Wasm instance loaded');
            return;
          }

          this.wasmInstance.exports.fm_synth_set_master_gain(this.ctxPtr, evt.data.masterGain);
          break;
        }
        case 'shutdown': {
          this.shutdown = true;
          break;
        }
        default: {
          console.warn('Unhandled message type in FM Synth AWP: ', evt.data.type);
        }
      }
    };
  }

  readStringFromWasmMemory = (ptr, len) => {
    const mem = new Uint8Array(this.getWasmMemoryBuffer().buffer);
    const slice = mem.subarray(ptr, ptr + len);
    return String.fromCharCode(...slice);
  };

  handleWasmPanic = (ptr, len) => {
    const str = this.readStringFromWasmMemory(ptr, len);
    throw new Error(str);
  };

  logErr = (ptr, len) => {
    const str = this.readStringFromWasmMemory(ptr, len);
    console.error(str);
  };

  log = (ptr, len) => {
    const str = this.readStringFromWasmMemory(ptr, len);
    console.log(str);
  };

  setOperatorState(operatorIx, mappedSamplesByMIDINumber) {
    const entries = Object.entries(mappedSamplesByMIDINumber);
    this.wasmInstance.exports.fm_synth_set_mapped_sample_midi_number_count(
      this.ctxPtr,
      operatorIx,
      entries.length
    );
    entries.forEach(([midiNumberStr, mappedSampleDataForMIDINumber], slotIx) => {
      const midiNumber = +midiNumberStr;
      this.wasmInstance.exports.fm_synth_set_mapped_sample_data_for_midi_number_slot(
        this.ctxPtr,
        operatorIx,
        slotIx,
        midiNumber,
        mappedSampleDataForMIDINumber.length
      );

      mappedSampleDataForMIDINumber.forEach(
        ({ doLoop, descriptor, gain, startIx, endIx, playbackRate }, mappedSampleIx) => {
          const sampleDescriptorHash = descriptor ? hashSampleDescriptor(descriptor) : null;
          const sampleDataIx = sampleDescriptorHash
            ? this.sampleDataIxByHashedSampleDescriptor.get(sampleDescriptorHash)
            : null;

          this.wasmInstance.exports.fm_synth_set_mapped_sample_config(
            this.ctxPtr,
            operatorIx,
            slotIx,
            mappedSampleIx,
            sampleDataIx ?? -1,
            doLoop ?? false,
            gain ?? 1,
            startIx ?? 0,
            endIx ?? 0,
            playbackRate ?? 1
          );
        }
      );
    });
  }

  setSampleMappingState(stateByOperatorIx) {
    const entries = Object.entries(stateByOperatorIx);
    for (const [operatorIxStr, { mappedSamplesByMIDINumber }] of entries) {
      const operatorIx = +operatorIxStr;
      this.setOperatorState(operatorIx, mappedSamplesByMIDINumber);
    }
  }

  async initWasm(wasmBytes, modulationMatrix, outputWeights, adsrs) {
    const importObject = {
      env: {
        log_panic: this.handleWasmPanic,
        log_err: (ptr, len) => this.logErr(ptr, len),
        log_raw: (ptr, len, _level) => this.log(ptr, len),
        debug1: (v1, v2, v3) => console.log({ v1, v2, v3 }),
        on_gate_cb: (midiNumber, voiceIx) => {
          this.port.postMessage({ type: 'onGate', midiNumber, voiceIx });
        },
        on_ungate_cb: (midiNumber, voiceIx) =>
          this.port.postMessage({ type: 'onUngate', midiNumber, voiceIx }),
      },
    };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    this.wasmInstance.exports.memory.grow(1024 * 4);
    this.ctxPtr = this.wasmInstance.exports.init_fm_synth_ctx();
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);

    outputWeights.forEach((paramSource, operatorIx) =>
      this.wasmInstance.exports.fm_synth_set_output_weight_value(
        this.ctxPtr,
        operatorIx,
        paramSource.valueType,
        paramSource.valParamInt,
        paramSource.valParamFloat,
        paramSource.valParamFloat2,
        paramSource.valParamFloat3
      )
    );
    adsrs.forEach(({ steps, lenSamples, releasePoint, loopPoint, logScale, adsrIx }) => {
      steps.forEach(({ x, y, ramper, param }, stepIx) => {
        this.wasmInstance.exports.set_adsr_step_buffer(stepIx, x, y, ramper, param);
      });
      this.wasmInstance.exports.set_adsr(
        this.ctxPtr,
        adsrIx,
        steps.length,
        lenSamples.valueType,
        lenSamples.valParamInt,
        lenSamples.valParamFloat,
        lenSamples.valParamFloat2,
        lenSamples.valParamFloat3,
        releasePoint,
        loopPoint ?? -1.0,
        logScale
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
          paramSource.valParamFloat2,
          paramSource.valParamFloat3
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
    if (this.wasmMemoryBuffer?.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  checkMailbox() {
    if (!this.mailboxID) {
      return;
    }

    let msg;
    while ((msg = globalThis.midiEventMailboxRegistry.getEvent(this.mailboxID))) {
      const { eventType, param1 } = msg;
      switch (eventType) {
        case 0: // Attack
          if (!this.wasmInstance) {
            console.warn('Tried gating before Wasm instance loaded');
            break;
          }

          this.wasmInstance.exports.gate(this.ctxPtr, param1);
          break;
        case 1: // Release
          if (!this.wasmInstance) {
            console.warn('Tried un-gating before Wasm instance loaded');
            break;
          }

          this.wasmInstance.exports.ungate(this.ctxPtr, param1);
          break;
        case 2: // Pitch bend
          console.error('Pitch bend not implemented');
          break;
        case 3: // Clear All
          if (!this.wasmInstance) {
            console.warn('Tried clearing all before Wasm instance loaded');
            break;
          }

          this.wasmInstance.exports.ungate_all(this.ctxPtr);
          break;
        default:
          console.error('Unhandled MIDI event type', evt);
      }
    }
  }

  process(_inputs, outputs, params) {
    if (!this.wasmInstance) {
      return true;
    }
    if (this.shutdown) {
      console.log('Shutting down FM Synth AWP', this.debugID);
      return false;
    }

    if (globalThis.globalTempoBPM) {
      this.wasmInstance.exports.set_cur_bpm(globalThis.globalTempoBPM);
    }

    this.checkMailbox();

    let wasmMemory = this.getWasmMemoryBuffer();
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

    // TODO: Only copy filter param buffers if they're being used
    const filterParamBuffersPtr = this.wasmInstance.exports.fm_synth_get_filter_param_buffers_ptr(
      this.ctxPtr
    );
    const filterParamBuffer = wasmMemory.subarray(
      filterParamBuffersPtr / BYTES_PER_F32,
      filterParamBuffersPtr / BYTES_PER_F32 + 4 * FRAME_SIZE
    );
    const qParam = params['filter_q'];
    const cutoffParam = params['filter_cutoff_freq'];
    const gainParam = params['filter_gain'];
    if (qParam.length === 1) {
      filterParamBuffer.fill(qParam[0], 0, FRAME_SIZE);
    } else {
      filterParamBuffer.set(qParam, 0);
    }
    if (cutoffParam.length === 1) {
      filterParamBuffer.fill(cutoffParam[0], FRAME_SIZE, FRAME_SIZE * 2);
    } else {
      filterParamBuffer.set(cutoffParam, FRAME_SIZE);
    }
    if (gainParam.length === 1) {
      filterParamBuffer.fill(gainParam[0], FRAME_SIZE * 2, FRAME_SIZE * 3);
    } else {
      filterParamBuffer.set(gainParam, FRAME_SIZE * 2);
    }

    const outputsPtr = this.wasmInstance.exports.fm_synth_generate(
      this.ctxPtr,
      globalThis.globalTempoBPM,
      // TODO: This causes things to sound weird when using filter envelope with beat length mode.
      //
      // Should probably investigate why that's happening and fix it at some point
      //
      // For now, setting it to 0 will disable the global beat counter synchronization.
      // globalThis.globalBeatCounterStarted ? globalThis.curBeat : 0
      0
    );
    wasmMemory = this.getWasmMemoryBuffer();
    const outputSlice = wasmMemory.subarray(outputsPtr / 4, outputsPtr / 4 + FRAME_SIZE);
    outputs[0]?.[0]?.set(outputSlice);

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
