import * as R from 'ramda';
import { Map } from 'immutable';

import { MIDINode, buildMIDINode, MIDIInputCbs } from 'src/patchNetwork/midiNode';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { midiToFrequency } from 'src/util';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';

const ctx = new AudioContext();

export class MIDIToFrequencyNode {
  public vcId: string;

  private midiNode: MIDINode;
  private frequencyCSN: ConstantSourceNode;
  private gateCSN: ConstantSourceNode;
  /**
   * List of note IDs that are currently pressed down.  We're always emitting the frequency of the last note in this array
   * and we're always gated if this array is non-empty.
   */
  private activeNotes: number[] = [];

  private noteToFrequency(note: number): number {
    return midiToFrequency(note); // TODO: Make configurable somehow
  }

  private gate(offset = 0) {
    this.gateCSN.offset.setValueAtTime(1, ctx.currentTime + offset);
  }

  private unGate(offset = 0) {
    this.gateCSN.offset.setValueAtTime(0, ctx.currentTime + offset);
  }

  private getMIDIInputCbs = (): MIDIInputCbs => ({
    onAttack: (note, _voiceIx, _velocity, offset?: number) => {
      this.gate(offset);
      this.frequencyCSN.offset.setValueAtTime(
        this.noteToFrequency(note),
        ctx.currentTime + (offset || 0)
      );

      if (R.isNil(offset)) {
        // Don't even try to do any kind of scheduling when offsets are involved; just set frequency and
        // gate at the offset.
        this.activeNotes.push(note);
      }
    },
    onRelease: (note, _voiceIx, _velocity, offset?: number) => {
      this.unGate(offset);

      if (R.isNil(offset)) {
        this.activeNotes = this.activeNotes.filter(compNote => compNote !== note);

        if (!R.isEmpty(this.activeNotes)) {
          this.frequencyCSN.offset.value = this.noteToFrequency(R.last(this.activeNotes)!);
        }
      }
    },
    onPitchBend: bendAmount => {
      // TODO
      console.log({ bendAmount });
    },
    onClearAll: (_stopPlayingNotes: boolean) => {
      this.gateCSN.offset.cancelScheduledValues(0);
      this.gateCSN.offset.value = 0;
      this.frequencyCSN.offset.cancelScheduledValues(0);
      this.activeNotes = [];
    },
  });

  public nodeType = 'customAudio/MIDIToFrequency';
  public name = 'MIDI to Frequency';

  /**
   * See the docs for `enhanceAudioNode`.
   */
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(vcId: string, _params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.frequencyCSN = new ConstantSourceNode(ctx);
    this.frequencyCSN.start();
    this.gateCSN = new ConstantSourceNode(ctx);
    this.gateCSN.offset.value = 0;
    this.gateCSN.start();

    this.midiNode = buildMIDINode(this.getMIDIInputCbs);
  }

  public buildConnectables(): AudioConnectables & { node: MIDIToFrequencyNode } {
    return {
      vcId: this.vcId,
      inputs: Map<string, ConnectableInput>().set('midi', { node: this.midiNode, type: 'midi' }),
      outputs: Map<string, ConnectableOutput>()
        .set('frequency', {
          node: this.frequencyCSN,
          type: 'number',
        })
        .set('gate', { node: this.gateCSN, type: 'number' }),
      node: this,
    };
  }

  public serialize(): { [key: string]: any } {
    return {}; // TODO
  }
}
