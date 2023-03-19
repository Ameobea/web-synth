const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;

class MultiADSR2AWP extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.adsrInstanceCount = options.processorOptions.instanceCount;
    if (typeof this.adsrInstanceCount !== 'number') {
      throw new Error(
        'Must provide a number for `options.processorOptions.instanceCount` to `MultiADSR2AWP`'
      );
    }

    this.isShutdown = false;
    this.outputRange = [0, 1];

    this.port.onmessage = async evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          this.outputRange = evt.data.outputRange;
          await this.initWasm(
            evt.data.wasmBytes,
            evt.data.encodedSteps,
            evt.data.loopPoint,
            evt.data.length,
            evt.data.lengthMode,
            evt.data.releaseStartPhase,
            evt.data.logScale,
            evt.data.earlyReleaseModeType,
            evt.data.earlyReleaseModeParam
          );
          break;
        }
        case 'setSteps': {
          if (!this.wasmInstance) {
            console.warn('Tried to set steps before wasm inst initialized in ADSR2 AWP');
            break;
          }
          this.setEncodedSteps(evt.data.encodedSteps);
          this.wasmInstance.exports.update_adsr_steps(this.ctxPtr);
          break;
        }
        case 'setLength': {
          if (!this.wasmInstance) {
            console.error('Tried to set ADSR2 length before initialization');
            break;
          }
          this.wasmInstance.exports.update_adsr_len_ms(
            this.ctxPtr,
            evt.data.length,
            evt.data.lengthMode
          );
          break;
        }
        case 'setLoopPoint': {
          if (!this.wasmInstance) {
            console.error('Tried to set ADSR2 loop point before initialization');
            break;
          }
          this.wasmInstance.exports.adsr_set_loop_point(this.ctxPtr, evt.data.loopPoint ?? -1);
          break;
        }
        case 'setReleaseStartPhase': {
          if (!this.wasmInstance) {
            console.error('Tried to set ADSR2 release start phase before initialization');
            break;
          }
          this.wasmInstance.exports.adsr_set_release_start_phase(
            this.ctxPtr,
            evt.data.releaseStartPhase
          );
          break;
        }
        case 'setLogScale': {
          this.wasmInstance.exports.adsr_set_log_scale(this.ctxPtr, evt.data.logScale);
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        case 'gate': {
          if (!this.wasmInstance) {
            console.warn('Tried to gate before wasm inst initialize in ADSR2 AWP');
            break;
          }
          this.wasmInstance.exports.gate_adsr(this.ctxPtr, evt.data.index, globalThis.curBeat);
          break;
        }
        case 'ungate': {
          if (!this.wasmInstance) {
            console.warn('Tried to ungate before wasm inst initialize in ADSR2 AWP');
            break;
          }
          this.wasmInstance.exports.ungate_adsr(this.ctxPtr, evt.data.index);
          break;
        }
        case 'setOutputRange': {
          this.outputRange = evt.data.outputRange;
          break;
        }
        case 'setFrozenOutputValue': {
          if (!this.wasmInstance) {
            console.warn(
              'Tried to set frozen output value before wasm inst initialize in ADSR2 AWP'
            );
            break;
          }
          this.wasmInstance.exports.adsr_set_frozen_output_value(
            this.ctxPtr,
            evt.data.value,
            this.outputRange[0],
            this.outputRange[1]
          );
          break;
        }
        case 'setFrozenOutputValueFromPhase': {
          if (!this.wasmInstance) {
            console.warn(
              'Tried to set frozen output value from phase before wasm inst initialize in ADSR2 AWP'
            );
            break;
          }
          this.wasmInstance.exports.adsr_set_frozen_output_value_from_phase(
            this.ctxPtr,
            evt.data.phase,
            this.outputRange[0],
            this.outputRange[1]
          );
          break;
        }
        default: {
          console.error('Unhandled message type in ADSR2 AWP: ', evt.data.type, evt.data);
        }
      }
    };
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  setEncodedSteps(encodedSteps) {
    if (encodedSteps.length % 4 !== 0) {
      throw new Error('Expected encoded steps length to be divisible by 4');
    }
    const encodedStepBufPtr = this.wasmInstance.exports.get_encoded_adsr_step_buf_ptr(
      encodedSteps.length / 4
    );
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    const stepBuf = this.wasmMemoryBuffer.subarray(
      encodedStepBufPtr / BYTES_PER_F32,
      encodedStepBufPtr / BYTES_PER_F32 + encodedSteps.length
    );
    stepBuf.set(encodedSteps);
  }

  async initWasm(
    wasmBytes,
    encodedSteps,
    loopPoint,
    length,
    lengthMode,
    releaseStartPhase,
    logScale,
    earlyReleaseModeType,
    earlyReleaseModeParam
  ) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, {
      env: {
        debug1: (v1, v2, v3) => console.log({ v1, v2, v3 }),
        log_err: (ptr, len) => {
          const memory = new Uint8Array(this.wasmInstance.exports.memory.buffer);
          const str = Array.from(memory.subarray(ptr, ptr + len))
            .map(v => String.fromCharCode(v))
            .join('');
          console.error(str);
        },
      },
    });

    this.setEncodedSteps(encodedSteps);

    this.ctxPtr = this.wasmInstance.exports.create_adsr_ctx(
      loopPoint ?? -1,
      length,
      lengthMode,
      releaseStartPhase,
      this.adsrInstanceCount,
      logScale,
      earlyReleaseModeType,
      earlyReleaseModeParam
    );
    this.outputBufPtrs = new Array(this.adsrInstanceCount)
      .fill(null)
      .map((_, i) => this.wasmInstance.exports.adsr_get_output_buf_ptr(this.ctxPtr, i));

    // Create `SharedArrayBuffer` to synchronize ADSR phase between the AWP and the UI
    if (typeof SharedArrayBuffer !== 'undefined') {
      this.audioThreadDataBufferInner = new SharedArrayBuffer(1 * BYTES_PER_F32);
      this.audioThreadDataBuffer = new Float32Array(this.audioThreadDataBufferInner);
    } else {
      this.audioThreadDataBuffer = new Float32Array(1);
    }
    this.port.postMessage({
      type: 'phaseDataBuffer',
      phaseDataBuffer: this.audioThreadDataBufferInner,
    });
  }

  /**
   *
   * @param {Float32Array[][]} _inputs
   * @param {Float32Array[][]} outputs
   * @param {{[key: string]: Float32Array}} _params
   * @returns {boolean}
   */
  process(_inputs, outputs, _params) {
    const output = outputs[0]?.[0];
    if (!output || !this.wasmInstance) {
      return true;
    } else if (this.isShutdown) {
      return false;
    }

    const curPhase = this.wasmInstance.exports.process_adsr(
      this.ctxPtr,
      this.outputRange[0],
      this.outputRange[1],
      globalThis.globalTempoBPM,
      globalThis.curBeat
    );
    // Record the current phase of the most recently gated ADSR which will be displayed
    // in the UI as an indicator on the ADSR UI
    this.audioThreadDataBuffer[0] = curPhase;
    for (let i = 0; i < this.adsrInstanceCount; i++) {
      const output = outputs[i]?.[0];
      if (!output) {
        console.warn(`No output for ADSR2 index ${i}`);
        continue;
      }

      const ptr = this.outputBufPtrs[i];
      const outputsSlice = this.getWasmMemoryBuffer().subarray(
        ptr / BYTES_PER_F32,
        ptr / BYTES_PER_F32 + FRAME_SIZE
      );
      output.set(outputsSlice);
    }

    return true;
  }
}

registerProcessor('multi-adsr2-awp', MultiADSR2AWP);
