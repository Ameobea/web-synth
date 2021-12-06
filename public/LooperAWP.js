const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;

class LooperAWP extends AudioWorkletProcessor {
  constructor() {
    super();

    this.didReleaseAfterStop = false;
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
        this.wasmInstance.exports.looper_set_next_bank_ix(data.nextBankIx);
        break;
      }
      case 'setLoopLenBeats': {
        this.wasmInstance.exports.looper_set_loop_len_beats(data.loopLenBeats);
        break;
      }
      case 'setCompositionForBank': {
        const { notes, bankIx } = data;
        this.wasmInstance.exports.looper_clear_bank(bankIx);
        notes.forEach(note =>
          this.wasmInstance.exports.looper_add_evt(bankIx, note.note, note.beat, note.isGate)
        );
        this.wasmInstance.exports.looper_finalize_bank(bankIx);
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
      if (this.wasmInstance && !this.didReleaseAfterStop) {
        this.wasmInstance.exports.looper_on_playback_stop();
        this.didReleaseAfterStop = true;
      }
      return true;
    }
    this.didReleaseAfterStop = false;

    this.wasmInstance.exports.looper_process(globalThis.curBeat);

    return true;
  }
}

registerProcessor('looper-awp', LooperAWP);
