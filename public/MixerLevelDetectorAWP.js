/**
 * Used for the mixer UI to display the levels of the audio tracks.
 *
 * Computes pre and post gains for each track in dB and writes into SAB for consumption by the UI.
 */

const BYTES_PER_F32 = 4;
const MAX_MIXER_TRACKS = 16;
const MIXER_LEVEL_DETECTOR_SAB_LENGTH = 2 * MAX_MIXER_TRACKS + 2; // add 2 for output gain
const FRAME_SIZE = 128;
const SAMPLE_RATE = 44_100;
// 1 full waveform at 20hz
const WINDOW_SIZE_SAMPLES = SAMPLE_RATE / 20;

const gainToDb = gain => {
  const absGain = Math.abs(gain);
  if (absGain <= 0.00001) {
    return -100;
  }
  return 20 * Math.log10(absGain);
};

class MixerLevelDetectorAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const params = [{ name: 'mixer_output', automationRate: 'a-rate' }];
    for (let i = 0; i < MAX_MIXER_TRACKS; i += 1) {
      params.push({
        name: `track_${i}_gain`,
        automationRate: 'k-rate',
      });
    }
    return params;
  }

  constructor() {
    super();

    this.wasmInstance = null;
    this.outputCtxPtr = 0;
    this.ctxPtrs = [];
    this.wasmMemoryBuffer = null;
    this.activeTrackCount = 0;
    this.isShutdown = false;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          this.initWasm(evt.data.wasmBytes);
          break;
        }
        case 'setActiveTrackCount': {
          this.activeTrackCount = evt.data.activeTrackCount;
          // TODO
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        default: {
          console.warn('Unhandled message type in mixer level detector AWP: ', evt.data.type);
        }
      }
    };

    if (typeof SharedArrayBuffer !== 'undefined') {
      this.audioThreadDataBufferInner = new SharedArrayBuffer(
        MIXER_LEVEL_DETECTOR_SAB_LENGTH * BYTES_PER_F32
      );
      this.audioThreadDataBuffer = new Float32Array(this.audioThreadDataBufferInner).fill(-100);
      this.port.postMessage({
        type: 'setAudioThreadDataBuffer',
        audioThreadDataBuffer: this.audioThreadDataBuffer,
      });
    }
  }

  handleWasmPanic = (ptr, len) => {
    const mem = new Uint8Array(this.getWasmMemoryBuffer().buffer);
    const slice = mem.subarray(ptr, ptr + len);
    const str = String.fromCharCode(...slice);
    console.error(`MixerLevelDetectorAWP Wasm panic: ${str}`);
  };

  async initWasm(wasmBytes) {
    const importObject = { env: { log_err: (ptr, len) => this.handleWasmPanic(ptr, len) } };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    for (let i = 0; i < MAX_MIXER_TRACKS; i += 1) {
      this.ctxPtrs.push(this.wasmInstance.exports.level_detector_create_ctx());
    }
    this.outputCtxPtr = this.wasmInstance.exports.level_detector_create_ctx();
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  processTrackAndWriteToSAB(wasmMemory, baseSABIx, input, ctxPtr, appliedGain) {
    const ioBufPtr = this.wasmInstance.exports.level_detector_get_io_buf_ptr(ctxPtr);
    const ioBuf = wasmMemory.subarray(
      ioBufPtr / BYTES_PER_F32,
      ioBufPtr / BYTES_PER_F32 + FRAME_SIZE
    );
    ioBuf.set(input);

    this.wasmInstance.exports.level_detector_process(ctxPtr, WINDOW_SIZE_SAMPLES);
    const postGain = ioBuf[FRAME_SIZE - 1];
    const preGain = appliedGain < 0.00001 ? 0 : postGain / appliedGain;

    const preGainDb = Math.max(gainToDb(preGain), -100);
    const postGainDb = Math.max(gainToDb(postGain), -100);
    if (Number.isNaN(preGainDb) || Number.isNaN(postGainDb)) {
      console.error('NaN in level detector', {
        preGain,
        postGain,
        appliedGain,
        preGainDb,
        postGainDb,
      });
    }

    this.audioThreadDataBuffer[baseSABIx] = preGainDb;
    this.audioThreadDataBuffer[baseSABIx + 1] = postGainDb;

    // low-pass with existing value to reduce flickering
    const oldPreGain = this.audioThreadDataBuffer[baseSABIx];
    this.audioThreadDataBuffer[baseSABIx] = Number.isNaN(oldPreGain)
      ? preGainDb
      : 0.8 * oldPreGain + 0.2 * preGainDb;
    const oldPostGain = this.audioThreadDataBuffer[baseSABIx + 1];
    this.audioThreadDataBuffer[baseSABIx + 1] = Number.isNaN(oldPostGain)
      ? postGainDb
      : 0.8 * oldPostGain + 0.2 * postGainDb;
  }

  process(inputs, _outputs, params) {
    if (!this.audioThreadDataBuffer) {
      // SAB not supported so this AWP is useless
      return false;
    }
    if (this.isShutdown) {
      return false;
    }

    if (!this.wasmInstance || this.ctxPtrs.length === 0) {
      return true;
    }
    const wasmMemory = this.getWasmMemoryBuffer();

    for (let trackIx = 0; trackIx < this.activeTrackCount; trackIx += 1) {
      const input = inputs[trackIx]?.[0];
      if (!input) {
        continue;
      }

      const ctxPtr = this.ctxPtrs[trackIx];
      const appliedGain = Math.abs(params[`track_${trackIx}_gain`][0] + 1);

      this.processTrackAndWriteToSAB(wasmMemory, trackIx * 2, input, ctxPtr, appliedGain);
    }

    const mixerOutput = params.mixer_output;
    this.processTrackAndWriteToSAB(wasmMemory, MAX_MIXER_TRACKS, mixerOutput, this.outputCtxPtr, 1);

    return true;
  }
}

registerProcessor('mixer-level-detector-awp', MixerLevelDetectorAWP);
