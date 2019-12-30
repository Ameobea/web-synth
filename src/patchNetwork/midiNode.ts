import * as R from 'ramda';
import { PromiseResolveType } from 'ameo-utils';

/**
 * The set of functions that must be provided to a MIDI node that accepts input from other MIDI nodes.
 */
export interface MIDIInputCbs {
  onAttack: (note: number, voiceIx: number, velocity: number, offset?: number) => void;
  onRelease: (note: number, voiceIx: number, velocity: number, offset?: number) => void;
  onPitchBend: (bendAmount: number, offset?: number) => void;
  onClearAll: () => void;
}

/**
 * A `MIDINode` is a special kind of connectable that deals with polyphonic MIDI events.  They are connectable
 * in the patch network with a connection type of 'midi'.
 */
export interface MIDINode {
  outputCbs: ReturnType<MIDINode['getInputCbs']>[];
  connect: (dst: MIDINode) => void;
  disconnect: (dst?: MIDINode) => void;
  /**
   * Returns a function that, when called, triggers an input on this MIDI node.  Must return the exact same object
   * each time it's called.
   */
  getInputCbs: () => MIDIInputCbs;
}

// hilarious
export type MIDIAccess = PromiseResolveType<ReturnType<typeof navigator['requestMIDIAccess']>>;

export const buildMIDINode = (getInputCbs: MIDINode['getInputCbs']): MIDINode => {
  let outputCbs: ReturnType<MIDINode['getInputCbs']>[] = [];

  return {
    outputCbs,
    connect: dst => {
      const inputCbs = dst.getInputCbs();
      // Make sure we're not already connected
      if (outputCbs.find(R.equals(inputCbs))) {
        console.warn('MIDI node already connected to destination');
        return;
      }

      outputCbs.push(inputCbs);
    },
    disconnect: dst => {
      if (!dst) {
        outputCbs = [];
        return;
      }

      const inputCbs = dst.getInputCbs();
      const beforeCbCount = outputCbs.length;
      outputCbs = outputCbs.filter(cbs => cbs !== inputCbs);

      if (beforeCbCount === outputCbs.length) {
        console.warn("Tried to disconnect two MIDI nodes but they weren't connected");
      }
    },
    getInputCbs,
  };
};
