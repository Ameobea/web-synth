import * as R from 'ramda';
import { Map } from 'immutable';

import { MIDINode, buildMIDINode, MIDIInputCbs } from 'src/patchNetwork/midiNode';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { midiToFrequency } from 'src/util';

const ctx = new AudioContext();

export class MIDIToFrequencyNode {
  public vcId: string;

  private midiNode: MIDINode;
  private frequencyCSN: ConstantSourceNode;
  private gainCSN: ConstantSourceNode;
  /**
   * List of note IDs that are currently pressed down.  We're always emitting the frequency of the last note in this array
   * and we're always gated if this array is non-empty.
   */
  private activeNotes: number[] = [];

  private noteToFrequency(note: number): number {
    return midiToFrequency(note); // TODO: Make configurable somehow
  }

  private getMIDIInputCbs(): MIDIInputCbs {
    return {
      onAttack: (note, _voiceIx, _velocity) => {
        this.activeNotes.push(note);
        this.frequencyCSN.offset.value = this.noteToFrequency(note);
      },
      onRelease: (note, _voiceIx, _velocity) => {
        this.activeNotes = this.activeNotes.filter(compNote => compNote !== note);
        if (R.isEmpty(this.activeNotes)) {
          this.gainCSN.offset.value = 0;
        } else {
          this.frequencyCSN.offset.value = this.noteToFrequency(R.last(this.activeNotes));
        }
      },
      onPitchBend: bendAmount => {
        // TODO
        console.log({ bendAmount });
      },
    };
  }

  public nodeType = 'customAudio/MIDIToFrequency';
  public name = 'MIDI to Frequency';

  constructor(vcId: string, _params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.frequencyCSN = new ConstantSourceNode(ctx);
    this.gainCSN = new ConstantSourceNode(ctx);

    this.midiNode = buildMIDINode(this.getMIDIInputCbs);
  }

  public buildConnectables(): AudioConnectables & { node: MIDIToFrequencyNode } {
    return {
      vcId: this.vcId,
      inputs: Map<string, ConnectableInput>().set('midi', { node: this.midiNode, type: 'midi' }),
      outputs: Map<string, ConnectableOutput>().set('frequency', {
        node: this.frequencyCSN,
        type: 'number',
      }),
      node: this,
    };
  }

  public serialize(): { [key: string]: any } {
    return {}; // TODO
  }
}
