import type { SavedMIDIComposition } from 'src/api';
import { MIDINode } from 'src/patchNetwork/midiNode';
import { looperDispatch } from 'src/redux';
import {
  looperActions,
  type LooperInstState,
  type LooperTransitionAlgorithm,
  parseLooperTransitionAlgorithmUIState,
} from 'src/redux/modules/looper';
import { AsyncOnce } from 'src/util';

const ctx = new AudioContext();

const LooperAWPRegistered = new AsyncOnce(() =>
  ctx.audioWorklet.addModule(
    process.env.ASSET_PATH +
      'LooperAWP.js?cacheBust=' +
      (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
  )
);

const LooperWasm = new AsyncOnce(() =>
  fetch(
    process.env.ASSET_PATH +
      'looper.wasm?cacheBust=' +
      (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
  ).then(res => res.arrayBuffer())
);

export class LooperNode {
  private vcId: string;
  /**
   * Sends output MIDI events created by the looper to connected destination modules
   */
  public midiNodes: MIDINode[] = [];
  private workletNode: AudioWorkletNode | null = null;
  private queuedMessages: any[] = [];
  private phaseSAB: Float32Array | null = null;
  private onPhaseSABReceived?: (phaseSAB: Float32Array) => void;

  constructor(
    vcId: string,
    serialized?: Omit<LooperInstState, 'looperNode'>,
    onPhaseSABReceived?: (phaseSAB: Float32Array) => void
  ) {
    this.vcId = vcId;
    this.onPhaseSABReceived = onPhaseSABReceived;

    if (serialized) {
      this.deserialize(serialized);
    }

    this.init();
  }

  private deserialize(serialized: Omit<LooperInstState, 'looperNode'>) {
    this.midiNodes = [];

    serialized.modules?.forEach((module, moduleIx) => {
      this.midiNodes.push(new MIDINode());

      module.banks?.forEach((bank, bankIx) => {
        this.setLoopLenBeats(moduleIx, bankIx, bank.lenBeats);
        if (!bank.loadedComposition) {
          return;
        }

        this.setCompositionForBank(moduleIx, bankIx, bank.loadedComposition, bank.lenBeats);
      });

      this.setActiveBankIx(moduleIx, module.activeBankIx);

      // Try to parse + set the UI transition algorithm, falling back to the last good applied algorithm otherwise
      const parsed = parseLooperTransitionAlgorithmUIState(
        module.transitionAlgorithm.uiState,
        module.activeBankIx
      );
      if (parsed.type === 'success') {
        this.setTransitionAlgorithm(moduleIx, parsed.value);
      } else {
        this.setTransitionAlgorithm(moduleIx, module.transitionAlgorithm.transitionAlgorithm);
      }
    });
    this.setActiveModuleIx(serialized.activeModuleIx);
  }

  private postMessage(msg: any) {
    if (this.workletNode) {
      this.workletNode.port.postMessage(msg);
    } else {
      this.queuedMessages.push(msg);
    }
  }

  public setCompositionForBank(
    moduleIx: number,
    bankIx: number,
    composition: SavedMIDIComposition | null,
    lenBeats: number
  ) {
    const notes: { note: number; isGate: boolean; beat: number }[] = [];

    const lineCount = composition?.composition.lines.length ?? 0;
    const lineIxToNote = (lineIx: number): number => lineCount - lineIx;

    composition?.composition.lines.forEach((line, lineIx) => {
      line.notes.forEach(note => {
        notes.push({
          note: lineIxToNote(lineIx),
          isGate: true,
          beat: note.startPoint,
        });
        notes.push({
          note: lineIxToNote(lineIx),
          isGate: false,
          beat: note.startPoint + note.length,
        });
      });
    });

    this.postMessage({
      type: 'setCompositionForBank',
      moduleIx,
      bankIx,
      notes,
      lenBeats,
    });
  }

  public setLoopLenBeats(moduleIx: number, bankIx: number, lenBeats: number) {
    this.postMessage({ type: 'setLoopLenBeats', moduleIx, bankIx, lenBeats });
  }

  public setActiveBankIx(moduleIx: number, bankIx: number | null) {
    this.postMessage({ type: 'setActiveBankIx', moduleIx, bankIx });
  }

  public setNextBankIx(moduleIx: number, nextBankIx: number) {
    this.postMessage({ type: 'setNextBankIx', moduleIx, nextBankIx });
  }

  public setActiveModuleIx(moduleIx: number) {
    while (this.midiNodes.length <= moduleIx) {
      this.midiNodes.push(new MIDINode());
    }

    this.postMessage({ type: 'setActiveModuleIx', moduleIx });
  }

  public deleteModule(moduleIx: number) {
    this.postMessage({ type: 'deleteModule', moduleIx });
  }

  private encodeTransitionAlgorithm(transitionAlgorithm: LooperTransitionAlgorithm): {
    transitionAlgorithmType: number;
    data: Float32Array;
  } {
    switch (transitionAlgorithm.type) {
      case 'constant':
        return { transitionAlgorithmType: 0, data: new Float32Array([transitionAlgorithm.bankIx]) };
      case 'staticPattern':
        return { transitionAlgorithmType: 1, data: new Float32Array(transitionAlgorithm.pattern) };
      default:
        throw new Error('Unknown transition algorithm type: ' + (transitionAlgorithm as any).type);
    }
  }

  public setTransitionAlgorithm(moduleIx: number, transitionAlgorithm: LooperTransitionAlgorithm) {
    this.postMessage({
      type: 'setTransitionAlgorithm',
      moduleIx,
      ...this.encodeTransitionAlgorithm(transitionAlgorithm),
    });
  }

  private async init() {
    const [looperWasm] = await Promise.all([LooperWasm.get(), LooperAWPRegistered.get()]);
    this.workletNode = new AudioWorkletNode(ctx, 'looper-awp');
    this.workletNode.port.postMessage({
      type: 'setWasmBytes',
      wasmBytes: looperWasm,
    });
    this.workletNode.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'playNote':
          this.midiNodes[evt.data.moduleIx]?.onAttack(evt.data.note, 255);
          break;
        case 'releaseNote':
          this.midiNodes[evt.data.moduleIx]?.onRelease(evt.data.note, 255);
          break;
        case 'phaseSAB':
          this.phaseSAB = new Float32Array(evt.data.phaseSAB);
          this.onPhaseSABReceived?.(this.phaseSAB);
          break;
        case 'setActiveBankIx':
          looperDispatch(
            looperActions.setActiveBankIx({
              vcId: this.vcId,
              moduleIx: evt.data.moduleIx,
              bankIx: evt.data.bankIx < 0 ? null : evt.data.bankIx,
              updateBackend: false,
            })
          );
          break;
        default:
          console.error('Unknown message from looper:', evt.data);
      }
    };

    this.queuedMessages.forEach(msg => this.postMessage(msg));
    this.queuedMessages = [];
  }
}
