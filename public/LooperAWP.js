class LooperAWP extends AudioWorkletProcessor {
  constructor() {
    super();

    this.didReleaseAfterStop = false;
    this.moduleIxForWhichToReportPhase = 0;
    this.pendingEvents = [];
    const curPhaseSAB =
      typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(8) : undefined;
    this.curPhaseBuffer = curPhaseSAB ? new Float32Array(curPhaseSAB) : undefined;

    this.port.onmessage = async evt => {
      if (!this.wasmInstance && evt.data.type !== 'setWasmBytes') {
        this.pendingEvents.push(evt.data);
      } else {
        this.handleMessage(evt.data);
      }
    };

    if (this.curPhaseBuffer) {
      this.port.postMessage({ type: 'phaseSAB', phaseSAB: this.curPhaseBuffer.buffer });
    }
  }

  handleMessage = async data => {
    switch (data.type) {
      case 'setWasmBytes': {
        await this.initWasm(data.wasmBytes);
        break;
      }
      case 'setActiveBankIx': {
        this.wasmInstance.exports.looper_activate_bank(
          data.moduleIx,
          data.bankIx ?? -1,
          globalThis.globalBeatCounterStarted ? globalThis.curBeat : -1
        );
        break;
      }
      case 'setNextBankIx': {
        this.wasmInstance.exports.looper_set_next_bank_ix(data.moduleIx, data.nextBankIx);
        break;
      }
      case 'setCompositionForBank': {
        const { moduleIx, notes, bankIx, lenBeats } = data;
        this.wasmInstance.exports.looper_clear_bank(moduleIx, bankIx);
        notes.forEach(note =>
          this.wasmInstance.exports.looper_add_evt(
            moduleIx,
            bankIx,
            note.note,
            note.beat,
            note.isGate
          )
        );
        this.wasmInstance.exports.looper_finalize_bank(moduleIx, bankIx, lenBeats);
        break;
      }
      case 'setLoopLenBeats': {
        this.wasmInstance.exports.looper_set_loop_len_beats(
          data.moduleIx,
          data.bankIx,
          data.lenBeats
        );
        break;
      }
      case 'setActiveModuleIx': {
        this.moduleIxForWhichToReportPhase = data.moduleIx;
        break;
      }
      case 'deleteModule': {
        this.wasmInstance.exports.looper_delete_module(data.moduleIx);
        break;
      }
      default: {
        console.warn('Unhandled message type in Looper AWP: ', evt.data.type);
      }
    }
  };

  playNote = (moduleIx, note) => this.port.postMessage({ type: 'playNote', moduleIx, note });

  releaseNote = (moduleIx, note) => this.port.postMessage({ type: 'releaseNote', moduleIx, note });

  async initWasm(wasmBytes) {
    const importObject = {
      env: {
        play_note: this.playNote,
        release_note: this.releaseNote,
      },
    };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);

    this.pendingEvents.forEach(data => this.handleMessage(data));
    this.pendingEvents = [];
  }

  process(_inputs, _outputs, _params) {
    if (!this.wasmInstance || !globalThis.globalBeatCounterStarted) {
      if (this.wasmInstance && !this.didReleaseAfterStop) {
        this.wasmInstance.exports.looper_on_playback_stop();
        if (this.curPhaseBuffer) {
          this.curPhaseBuffer[1] = -1;
        }
        this.didReleaseAfterStop = true;
      }
      return true;
    }
    this.didReleaseAfterStop = false;

    const phase = this.wasmInstance.exports.looper_process(
      this.moduleIxForWhichToReportPhase,
      globalThis.curBeat
    );
    if (this.curPhaseBuffer) {
      this.curPhaseBuffer[0] = phase;
      this.curPhaseBuffer[1] = this.wasmInstance.exports.looper_get_playing_bank_ix(
        this.moduleIxForWhichToReportPhase
      );
    }

    return true;
  }
}

registerProcessor('looper-awp', LooperAWP);
