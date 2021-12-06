import type { SavedMIDIComposition } from 'src/api';
import type { MIDINode } from 'src/patchNetwork/midiNode';
import type { LooperInstState } from 'src/redux/modules/looper';
import { AsyncOnce } from 'src/util';

const ctx = new AudioContext();

const LooperAWPRegistered = new AsyncOnce(() =>
  ctx.audioWorklet.addModule(
    '/LooperAWP.js?cacheBust=' +
      (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
  )
);

const LooperWasm = new AsyncOnce(() =>
  fetch(
    '/looper.wasm?cacheBust=' +
      (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
  ).then(res => res.arrayBuffer())
);

export class LooperNode {
  private vcId: string;
  /**
   * Sends output MIDI events created by the looper to connected destination modules
   */
  private midiNode: MIDINode;
  private workletNode: AudioWorkletNode | null = null;
  private queuedMessages: any[] = [];

  constructor(vcId: string, midiNode: MIDINode, serialized?: Omit<LooperInstState, 'looperNode'>) {
    this.vcId = vcId;
    this.midiNode = midiNode;

    if (serialized) {
      this.deserialize(serialized);
    }

    this.init();
  }

  private deserialize(serialized: Omit<LooperInstState, 'looperNode'>) {
    serialized.banks?.forEach((bank, bankIx) => {
      if (!bank.loadedComposition) {
        return;
      }

      this.setCompositionForBank(bankIx, bank.loadedComposition);
    });

    this.setActiveBankIx(serialized.activeBankIx);
  }

  private postMessage(msg: any) {
    if (this.workletNode) {
      this.workletNode.port.postMessage(msg);
    } else {
      this.queuedMessages.push(msg);
    }
  }

  public setCompositionForBank(bankIx: number, composition: SavedMIDIComposition) {
    const notes: { note: number; isGate: boolean; beat: number }[] = [];

    const lineCount = composition.composition.lines.length;
    const lineIxToNote = (lineIx: number): number => lineCount - lineIx;

    composition.composition.lines.forEach((line, lineIx) => {
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
      bankIx,
      notes,
    });
  }

  public setActiveBankIx(bankIx: number | null) {
    this.postMessage({ type: 'setActiveBankIx', bankIx });
  }

  public setNextBankIx(nextBankIx: number) {
    this.postMessage({ type: 'setNextBankIx', nextBankIx });
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
          this.midiNode.onAttack(evt.data.note, 255);
          break;
        case 'releaseNote':
          this.midiNode.onRelease(evt.data.note, 255);
          break;
        default:
          console.error('Unknown message from looper:', evt.data);
      }
    };

    this.queuedMessages.forEach(msg => this.postMessage(msg));
    this.queuedMessages = [];
  }
}
