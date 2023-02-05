const BYTES_PER_F32 = 4;

class LooperAWP extends AudioWorkletProcessor {
  constructor() {
    super();

    this.didReleaseAfterStop = false;
    this.isStarted = false;
    this.moduleIxForWhichToReportPhase = 0;
    this.pendingEvents = [];
    const curPhaseSAB =
      typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(8) : undefined;
    this.curPhaseBuffer = curPhaseSAB ? new Float32Array(curPhaseSAB) : undefined;
    this.mailboxIDsByModuleIx = new Array(64).fill(null);
    this.needsUIThreadSchedulingByModuleIX = new Array(64).fill(true);

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
        const { moduleIx, notes, bankIx, lenBeats, mailboxIDs, needsUIThreadScheduling } = data;
        this.mailboxIDsByModuleIx[moduleIx] = mailboxIDs;
        this.needsUIThreadSchedulingByModuleIX[moduleIx] = needsUIThreadScheduling;
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
      case 'setTransitionAlgorithm': {
        this.wasmInstance.exports.looper_init_transition_algorithm_buffer(data.data.length);
        const transitionAlgorithmBufferPtr =
          this.wasmInstance.exports.looper_get_transition_algorithm_buffer_ptr();
        const transitionAlgorithmBuffer = new Float32Array(
          this.wasmInstance.exports.memory.buffer
        ).subarray(
          transitionAlgorithmBufferPtr / BYTES_PER_F32,
          transitionAlgorithmBufferPtr / BYTES_PER_F32 + data.data.length
        );
        transitionAlgorithmBuffer.set(data.data);
        this.wasmInstance.exports.looper_set_transition_algorithm(
          data.moduleIx,
          data.transitionAlgorithmType
        );
        break;
      }
      case 'updateMIDISchedulingInfoForModule': {
        const { moduleIx, mailboxIDs, needsUIThreadScheduling } = data;
        this.mailboxIDsByModuleIx[moduleIx] = mailboxIDs;
        this.needsUIThreadSchedulingByModuleIX[moduleIx] = needsUIThreadScheduling;
        break;
      }
      default: {
        console.error('Unhandled message type in Looper AWP: ', data);
      }
    }
  };

  playNote = (moduleIx, note) => {
    const needsUIThreadScheduling = this.needsUIThreadSchedulingByModuleIX[moduleIx];
    const mailboxIDs = this.mailboxIDsByModuleIx[moduleIx];

    if (needsUIThreadScheduling) {
      this.port.postMessage({ type: 'playNote', moduleIx, note });
    }

    if (mailboxIDs) {
      for (const mailboxID of mailboxIDs) {
        globalThis.midiEventMailboxRegistry.submitEvent(mailboxID, 0, note, 255);
      }
    }
  };

  releaseNote = (moduleIx, note) => {
    const needsUIThreadScheduling = this.needsUIThreadSchedulingByModuleIX[moduleIx];
    const mailboxIDs = this.mailboxIDsByModuleIx[moduleIx];

    if (needsUIThreadScheduling) {
      this.port.postMessage({ type: 'releaseNote', moduleIx, note });
    }

    if (this.mailboxIDsByModuleIx[moduleIx]) {
      for (const mailboxID of mailboxIDs) {
        globalThis.midiEventMailboxRegistry.submitEvent(mailboxID, 1, note, 255);
      }
    }
  };

  setActiveBankIx = (moduleIx, bankIx) =>
    this.port.postMessage({ type: 'setActiveBankIx', moduleIx, bankIx });

  async initWasm(wasmBytes) {
    const importObject = {
      env: {
        play_note: this.playNote,
        release_note: this.releaseNote,
        set_active_bank_ix: this.setActiveBankIx,
      },
    };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);

    this.pendingEvents.forEach(data => this.handleMessage(data));
    this.pendingEvents = [];
  }

  process(_inputs, _outputs, _params) {
    if (!this.wasmInstance || !globalThis.globalBeatCounterStarted) {
      if (!globalThis.globalBeatCounterStarted) {
        this.isStarted = false;
      }
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
    if (!this.isStarted) {
      this.isStarted = true;
      this.wasmInstance.exports.looper_on_playback_start();
    }

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
