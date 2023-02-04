import { UnreachableException, type PromiseResolveType } from 'ameo-utils';
import * as R from 'ramda';

/**
 * The set of functions that must be provided to a MIDI node that accepts input from other MIDI nodes.
 */
export interface MIDIInputCbs {
  onAttack: (note: number, velocity: number) => void;
  onRelease: (note: number, velocity: number) => void;
  onPitchBend: (bendAmount: number) => void;
  onClearAll: () => void;
  onGenericControl?: (controlIndex: number, controlValue: number) => void;
}

// hilarious
export type MIDIAccess = PromiseResolveType<ReturnType<typeof navigator['requestMIDIAccess']>>;

export const mkBuildPasthroughInputCBs = (node: MIDINode) => (): MIDIInputCbs => ({
  onAttack: (note, velocity) => node.onAttack(note, velocity),
  onRelease: (note, velocity) => node.onRelease(note, velocity),
  onPitchBend: bendAmount => node.outputCbs.forEach(cb => cb.onPitchBend(bendAmount)),
  onClearAll: () => node.outputCbs.forEach(cbs => cbs.onClearAll()),
  onGenericControl: (controlIndex, controlValue) =>
    node.outputCbs.forEach(cbs => cbs.onGenericControl?.(controlIndex, controlValue)),
});

/**
 * A `MIDINode` is a special kind of connectable that deals with polyphonic MIDI events.  They are connectable
 * in the patch network with a connection type of 'midi'.
 */
export class MIDINode {
  private outputCbs_: MIDIInputCbs[] = [];
  public getInputCbs: () => MIDIInputCbs;
  private cachedInputCbs: MIDIInputCbs | null = null;
  /**
   * If set to true, indicates that this MIDI node is able to receive events directly on the audio thread.
   */
  public enableRxAudioThreadScheduling: false | { mailboxID: string } = false;

  constructor(getInputCbs?: (() => MIDIInputCbs) | undefined) {
    this.getInputCbs =
      getInputCbs ??
      (() => {
        throw new UnreachableException("MIDI node doesn't accept inputs");
      });
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

  public onAttack(note: number, velocity: number) {
    this.outputCbs.forEach(cbs => cbs.onAttack(note, velocity));
  }

  public onRelease(note: number, velocity: number) {
    this.outputCbs.forEach(cbs => cbs.onRelease(note, velocity));
  }

  public clearAll() {
    this.outputCbs.forEach(cbs => cbs.onClearAll());
  }
}
