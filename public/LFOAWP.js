const FRAME_SIZE = 128;

class LfoAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'frequency',
        defaultValue: 0,
        minValue: 0,
        automationRate: 'a-rate',
      },
    ];
  }

  constructor() {
    super({ numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });

    this.ctxPtr = 0;
    this.wasmInst = null;
    this.wasmMemoryF32 = null;
    this.phaseView = null;
    this.freqBuf = null;
    this.outBuf = null;
    this.shutdown = false;
    this.didSetState = false;
    this.lastPlaybackSeq = globalThis.playbackSeq;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setWasmBytes':
          this.initWasm(evt.data.wasmBytes);
          break;
        case 'setOscillator': {
          const { oscType, param0 } = evt.data;
          this.wasmInst.exports.lfo_set_oscillator_type(this.ctxPtr, oscType, param0);
          this.didSetState = true;
          break;
        }
        case 'setPhaseInit': {
          const {
            phaseInit: { setPhaseOnPlaybackStart, startPhase },
          } = evt.data;
          this.wasmInst.exports.lfo_set_phase_init(
            this.ctxPtr,
            setPhaseOnPlaybackStart,
            startPhase
          );
          if (!this.didSetState) {
            this.wasmInst.exports.lfo_set_phase(this.ctxPtr, startPhase);
          }
          break;
        }
        case 'setPhase':
          this.wasmInst.exports.lfo_set_phase(this.ctxPtr, evt.data.phase);
          break;
        case 'shutdown':
          this.shutdown = true;
          break;
        default:
          console.error('Unknown message type in LFOAWP: ', evt.data.type);
      }
    };
  }

  async initWasm(wasmBytes) {
    const imports = { env: {} };
    const mod = await WebAssembly.compile(wasmBytes);
    this.wasmInst = await WebAssembly.instantiate(mod, imports);

    this.ctxPtr = this.wasmInst.exports.lfo_init();

    const freqPtr = this.wasmInst.exports.lfo_get_freq_input_buf_ptr(this.ctxPtr);
    const outPtr = this.wasmInst.exports.lfo_get_output_buf_ptr(this.ctxPtr);

    this.wasmMemoryF32 = new Float32Array(this.wasmInst.exports.memory.buffer);
    this.freqBuf = this.wasmMemoryF32.subarray(
      freqPtr / Float32Array.BYTES_PER_ELEMENT,
      freqPtr / Float32Array.BYTES_PER_ELEMENT + FRAME_SIZE
    );
    this.outBuf = this.wasmMemoryF32.subarray(
      outPtr / Float32Array.BYTES_PER_ELEMENT,
      outPtr / Float32Array.BYTES_PER_ELEMENT + FRAME_SIZE
    );

    if (typeof SharedArrayBuffer !== 'undefined') {
      const phaseSAB = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT);
      this.phaseView = new Float32Array(phaseSAB);
      this.port.postMessage({ type: 'setPhaseSAB', sab: this.phaseView });
    }

    this.port.postMessage({ type: 'ready' });
  }

  /**
   * @param {Float32Array[][]} _inputs
   * @param {Float32Array[][]} outputs
   * @param {{frequency: Float32Array}} params
   * @returns {boolean}
   */
  process(_inputs, outputs, params) {
    if (this.shutdown) {
      return false;
    } else if (!this.ctxPtr || !this.didSetState) {
      return true;
    }

    const freqParam = params.frequency;
    if (freqParam.length === 1) {
      this.freqBuf.fill(freqParam[0]);
    } else {
      this.freqBuf.set(freqParam);
    }

    const curBeat = globalThis.curBeat;
    const playbackDidStartOrRestart =
      globalThis.globalBeatCounterStarted && this.lastPlaybackSeq !== globalThis.playbackSeq;
    if (playbackDidStartOrRestart) {
      const curFreq = freqParam[freqParam.length - 1];
      this.wasmInst.exports.lfo_on_playback_start(
        this.ctxPtr,
        globalThis.globalTempoBPM,
        curBeat,
        curFreq
      );
    }
    this.lastPlaybackSeq = globalThis.playbackSeq;

    this.wasmInst.exports.lfo_process(this.ctxPtr);

    const freqPtr = this.wasmInst.exports.lfo_get_freq_input_buf_ptr(this.ctxPtr);
    const outPtr = this.wasmInst.exports.lfo_get_output_buf_ptr(this.ctxPtr);

    this.wasmMemoryF32 = new Float32Array(this.wasmInst.exports.memory.buffer);
    this.freqBuf = this.wasmMemoryF32.subarray(
      freqPtr / Float32Array.BYTES_PER_ELEMENT,
      freqPtr / Float32Array.BYTES_PER_ELEMENT + FRAME_SIZE
    );
    this.outBuf = this.wasmMemoryF32.subarray(
      outPtr / Float32Array.BYTES_PER_ELEMENT,
      outPtr / Float32Array.BYTES_PER_ELEMENT + FRAME_SIZE
    );

    outputs[0][0].set(this.outBuf);

    if (this.phaseView) {
      this.phaseView[0] = this.wasmInst.exports.lfo_get_phase(this.ctxPtr);
    }

    return true;
  }
}

registerProcessor('lfo-awp', LfoAWP);
