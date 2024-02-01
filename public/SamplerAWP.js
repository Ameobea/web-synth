const PARAM_DESCRIPTORS = [];
const FRAME_SIZE = 128;
const BYTES_PER_F32 = 4;
const MIDI_GATE_STATUS_BUFFER_UPDATED_IX = 512;

class SamplerAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAM_DESCRIPTORS;
  }

  constructor({ processorOptions }) {
    super();

    this.isShutdown = false;
    this.ctxPtr = 0;
    this.wasmInstance = null;
    this.wasmMemoryBuffer = null;
    this.pendingMessages = [];
    this.transmitMIDIAttack = false;
    this.midiGateStatusSAB = null;
    this.midiGateStatusF32 = null;
    this.midiGateStatusI32 = null;
    if (
      typeof SharedArrayBuffer !== 'undefined' &&
      typeof Atomics !== 'undefined' &&
      typeof Atomics.waitAsync === 'function'
    ) {
      this.midiGateStatusSAB = new SharedArrayBuffer((512 + 8) * BYTES_PER_F32);
      this.midiGateStatusF32 = new Float32Array(this.midiGateStatusSAB);
      this.midiGateStatusI32 = new Int32Array(this.midiGateStatusSAB);
      this.port.postMessage({
        type: 'midiGateStatusSAB',
        midiGateStatusSAB: this.midiGateStatusSAB,
      });
    } else {
      console.warn(
        'SamplerAWP: `SharedArrayBuffer`, `Atomics`, or `Atomics.waitAsync` not available, MIDI gate status will not be available'
      );
    }

    this.port.onmessage = evt => this.handleMessage(evt.data);

    if (!processorOptions.mailboxID) {
      throw new Error('SamplerAWP requires a mailboxID to be passed in processorOptions');
    }
    this.mailboxID = processorOptions.mailboxID;
    globalThis.midiEventMailboxRegistry.addMailbox(processorOptions.mailboxID);
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  async initWasmInstance(wasmBytes) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, { env: {} });

    this.ctxPtr = this.wasmInstance.exports.init_sampler_ctx();
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);

    this.pendingMessages.forEach(data => this.handleMessage(data));
    this.pendingMessages = [];
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
        this.initWasmInstance(data.wasmBytes);
        break;
      }
      case 'shutdown': {
        this.isShutdown = true;
        break;
      }
      case 'setSampleData': {
        const { sampleData } = data;
        let wasmMemory = this.getWasmMemoryBuffer();
        const sampleDataPtr = this.wasmInstance.exports.sampler_get_sample_data_ptr(
          this.ctxPtr,
          sampleData.length
        );
        // Memory might have been reallocated, so we need to get the pointer again
        wasmMemory = this.getWasmMemoryBuffer();
        wasmMemory.set(sampleData, sampleDataPtr / BYTES_PER_F32);

        break;
      }
      case 'setSelection': {
        const {
          midiNumber,
          startSampleIx,
          endSampleIx,
          crossfadeStartLenSamples,
          crossfadeEndLenSamples,
          playbackRate,
          reverse,
        } = data.selection;
        this.wasmInstance.exports.sampler_set_selection(
          this.ctxPtr,
          midiNumber,
          startSampleIx,
          endSampleIx,
          crossfadeStartLenSamples,
          crossfadeEndLenSamples,
          playbackRate,
          reverse
        );
        break;
      }
      case 'clearSelection': {
        const { index } = data;
        this.wasmInstance.exports.sampler_clear_selection(this.ctxPtr, index);
        break;
      }
      case 'captureNextMIDIAttack': {
        this.transmitMIDIAttack = true;
        break;
      }
      default: {
        console.error('Unhandled message type in sampler player AWP: ', data.type);
      }
    }
  }

  checkMailbox() {
    if (!this.mailboxID) {
      return;
    }

    let msg;
    while ((msg = globalThis.midiEventMailboxRegistry.getEvent(this.mailboxID))) {
      const { eventType, param1 } = msg;
      switch (eventType) {
        case 0: {
          this.wasmInstance.exports.sampler_handle_midi_attack(this.ctxPtr, param1);
          if (this.transmitMIDIAttack) {
            this.port.postMessage({ type: 'midiAttack', midiNumber: param1 });
            this.transmitMIDIAttack = false;
          }
          if (this.midiGateStatusF32) {
            this.midiGateStatusF32[param1] = 1;
            Atomics.notify(this.midiGateStatusI32, MIDI_GATE_STATUS_BUFFER_UPDATED_IX);
          }
          break;
        }
        case 1: {
          if (this.midiGateStatusF32) {
            this.midiGateStatusF32[param1] = 0;
            Atomics.notify(this.midiGateStatusI32, MIDI_GATE_STATUS_BUFFER_UPDATED_IX);
          }
          break;
        }
        default:
        // pass
      }
    }
  }

  process(_inputs, outputs, _params) {
    if (this.isShutdown) {
      return false;
    } else if (!this.ctxPtr) {
      return true;
    }

    this.checkMailbox();
    this.wasmInstance.exports.sampler_process(this.ctxPtr);
    const outputBufPtr = this.wasmInstance.exports.sampler_get_output_buf_ptr(this.ctxPtr);
    const wasmMemory = this.getWasmMemoryBuffer();
    const outputBuf = wasmMemory.subarray(
      outputBufPtr / BYTES_PER_F32,
      outputBufPtr / BYTES_PER_F32 + FRAME_SIZE
    );

    for (let i = 0; i < outputs.length; i++) {
      for (let j = 0; j < outputs[i].length; j++) {
        outputs[i][j].set(outputBuf);
      }
    }

    return true;
  }
}

registerProcessor('sampler-awp', SamplerAWP);
