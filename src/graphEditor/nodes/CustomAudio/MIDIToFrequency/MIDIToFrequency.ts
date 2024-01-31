import { Map } from 'immutable';
import * as R from 'ramda';
import { writable, type Unsubscriber } from 'svelte/store';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { MIDINode, type MIDIInputCbs } from 'src/patchNetwork/midiNode';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { midiToFrequency } from 'src/util';
import MidiToFrequencySmallView, { RegateMode } from './MIDIToFrequencySmallView.svelte';

export interface MIDIToFrequencyState {
  regateMode: RegateMode;
}

const buildDefaultMIDIToFrequencyState = (): MIDIToFrequencyState => ({
  regateMode: RegateMode.AnyAttack,
});

export class MIDIToFrequencyNode {
  public vcId: string;

  private ctx: AudioContext;
  private midiNode: MIDINode;
  private frequencyCSN: ConstantSourceNode;
  private detuneCSN: ConstantSourceNode;
  private gateCSN: ConstantSourceNode;
  /**
   * List of note IDs that are currently pressed down.  We're always emitting the frequency of the last note in this array
   * and we're always gated if this array is non-empty.
   */
  private activeNotes: number[] = [];
  private state: MIDIToFrequencyState;

  private noteToFrequency(note: number): number {
    return midiToFrequency(note); // TODO: Make configurable somehow
  }

  private gate() {
    switch (this.state.regateMode) {
      case RegateMode.AnyAttack:
        this.gateCSN.offset.setValueAtTime(0, this.ctx.currentTime);
        this.gateCSN.offset.linearRampToValueAtTime(1, this.ctx.currentTime + 0.000001);
        break;
      case RegateMode.NoNotesHeld:
        this.gateCSN.offset.setValueAtTime(1, this.ctx.currentTime);
        break;
      default:
        throw new Error(`Unknown regate mode: ${this.state.regateMode}`);
    }
  }

  private unGate() {
    this.gateCSN.offset.setValueAtTime(0, this.ctx.currentTime);
  }

  private getMIDIInputCbs = (): MIDIInputCbs => ({
    onAttack: (note, _velocity) => {
      this.gate();

      this.frequencyCSN.offset.setValueAtTime(this.noteToFrequency(note), this.ctx.currentTime);

      this.activeNotes.push(note);
    },
    onRelease: (note, _velocity) => {
      this.activeNotes = this.activeNotes.filter(compNote => compNote !== note);

      if (!R.isEmpty(this.activeNotes)) {
        this.frequencyCSN.offset.value = this.noteToFrequency(R.last(this.activeNotes)!);
      } else {
        this.unGate();
      }
    },
    onPitchBend: _bendAmount => {
      // no-op
    },
    onClearAll: () => {
      this.gateCSN.offset.cancelScheduledValues(0);
      this.gateCSN.offset.value = 0;
      this.frequencyCSN.offset.cancelScheduledValues(0);
      this.activeNotes = [];
    },
  });

  public nodeType = 'customAudio/MIDIToFrequency';
  static typeName = 'MIDI to Frequency';

  /**
   * See the docs for `enhanceAudioNode`.
   */
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;
    this.state = this.deserialize(params);
    this.frequencyCSN = new ConstantSourceNode(ctx);
    this.frequencyCSN.start();
    this.gateCSN = new ConstantSourceNode(ctx);
    this.gateCSN.offset.value = 0;
    this.gateCSN.start();
    this.detuneCSN = new ConstantSourceNode(ctx);
    this.detuneCSN.start();
    this.detuneCSN.offset.value = 0;
    this.frequencyCSN.connect(this.detuneCSN.offset);

    this.midiNode = new MIDINode(this.getMIDIInputCbs);

    let unsubscribe: Unsubscriber | undefined;
    const store = writable(this.state);

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: MidiToFrequencySmallView,
      getProps: () => ({ state: store }),
      predicate: () => {
        unsubscribe = store.subscribe(newState => this.handleChange(newState));
      },
    });

    this.cleanupSmallView = mkSvelteContainerCleanupHelper({
      preserveRoot: true,
      predicate: () => unsubscribe?.(),
    });
  }

  private handleChange(newState: MIDIToFrequencyState) {
    this.state = newState;
  }

  public buildConnectables(): AudioConnectables & { node: MIDIToFrequencyNode } {
    return {
      vcId: this.vcId,
      inputs: Map<string, ConnectableInput>()
        .set('detune', {
          node: this.detuneCSN.offset,
          type: 'number',
        })
        .set('midi', { node: this.midiNode, type: 'midi' }),
      outputs: Map<string, ConnectableOutput>()
        .set('frequency', {
          node: this.detuneCSN,
          type: 'number',
        })
        .set('gate', { node: this.gateCSN, type: 'number' }),
      node: this,
    };
  }

  public serialize(): Record<string, any> {
    return { ...this.state };
  }

  public deserialize(params: Record<string, any> | null | undefined): MIDIToFrequencyState {
    if (!params) {
      return buildDefaultMIDIToFrequencyState();
    }

    return { ...params, regateMode: params.regateMode ?? RegateMode.AnyAttack };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
