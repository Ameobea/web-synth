import * as R from 'ramda';
import { PromiseResolveType } from 'ameo-utils';

/**
 * The set of functions that must be provided to a MIDI node that accepts input from other MIDI nodes.
 */
export interface MIDIInputCbs {
  onAttack: (note: number, voiceIx: number, velocity: number, offset?: number) => void;
  onRelease: (note: number, voiceIx: number, velocity: number, offset?: number) => void;
  onPitchBend: (bendAmount: number, offset?: number) => void;
  onClearAll: (stopPlayingNotes: boolean) => void;
}

// hilarious
export type MIDIAccess = PromiseResolveType<ReturnType<typeof navigator['requestMIDIAccess']>>;

/**
 * A `MIDINode` is a special kind of connectable that deals with polyphonic MIDI events.  They are connectable
 * in the patch network with a connection type of 'midi'.
 */
export class MIDINode {
  private outputCbs_: MIDIInputCbs[] = [];
  private getInputCbs: () => MIDIInputCbs;
  private cachedInputCbs: MIDIInputCbs | null = null;

  constructor(getInputCbs: () => MIDIInputCbs) {
    this.getInputCbs = getInputCbs;
  }

  /**
   * Returns a function that, when called, triggers an input on this MIDI node.  Must return the exact same object
   * each time it's called.
   */
  public get inputCbs(): MIDIInputCbs {
    if (!this.cachedInputCbs) {
      this.cachedInputCbs = this.getInputCbs();
    }

    return this.cachedInputCbs!;
  }

  /**
   * Don't hold references to the array returned by this!  The array's pointer can change at any time.
   *
   * Always call this getter to get the latest instance of the output callbacks array.
   */
  public get outputCbs() {
    return this.outputCbs_;
  }

  public connect(dst: MIDINode) {
    const inputCbs = dst.inputCbs;
    // Make sure we're not already connected
    if (this.outputCbs_.find(R.equals(inputCbs))) {
      return;
    }

    this.outputCbs_.push(inputCbs);
  }

  public disconnect(dst?: MIDINode) {
    if (!dst) {
      this.outputCbs_ = [];
      return;
    }

    const inputCbs = dst.inputCbs;
    const beforeCbCount = this.outputCbs_.length;
    this.outputCbs_ = this.outputCbs_.filter(cbs => cbs !== inputCbs);

    if (beforeCbCount === this.outputCbs_.length) {
      console.warn("Tried to disconnect two MIDI nodes but they weren't connected");
    }
  }
}

export const buildMIDINode = (getInputCbs: () => MIDIInputCbs) => new MIDINode(getInputCbs);
