const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;

class LooperAWP extends AudioWorkletProcessor {
  constructor() {
    super();

    this.pendingEvents = [];

    this.port.onmessage = async evt => {
      if (!this.wasmInstance && evt.data.type !== 'setWasmBytes') {
        this.pendingEvents.push(evt.data);
      } else {
        this.handleMessage(evt.data);
      }
    };
  }

  handleMessage = async data => {
    switch (data.type) {
      case 'setWasmBytes': {
        await this.initWasm(data.wasmBytes);
        break;
      }
      case 'setActiveBankIx': {
        this.wasmInstance.exports.looper_activate_bank(data.bankIx, globalThis.curBeat);
        break;
      }
      case 'setNextBankIx': {
        this.wasmInstance.exports.looper_set_next_bank_ix(data.bankIx);
        break;
      }
      case 'setLoopLenBeats': {
        this.wasmInstance.exports.looper_set_loop_len_beats(data.loopLenBeats);
        break;
      }
      case 'setBank': {
        const { notes, bankIx } = data;
        throw new Error('Not implemented');
        break;
      }
      default: {
        console.warn('Unhandled message type in Looper AWP: ', evt.data.type);
      }
    }
  };

  playNote = note => this.port.postMessage({ type: 'playNote', note });

  releaseNote = note => this.port.postMessage({ type: 'releaseNote', note });

  async initWasm(wasmBytes) {
    const importObject = { env: { play_note: this.playNote, release_note: this.releaseNote } };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);

    this.pendingEvents.forEach(data => this.handleMessage(data));
    this.pendingEvents = [];
  }

  process(_inputs, _outputs, _params) {
    if (!this.wasmInstance || globalThis.curBeat === 0) {
      return true;
    }

    this.wasmInstance.exports.looper_process(globalThis.curBeat);

    return true;
  }
}

registerProcessor('looper-awp', LooperAWP);
