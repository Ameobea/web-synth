/* eslint-disable @typescript-eslint/no-empty-function */

import type { MIDIInputCbs, MIDINode, MIDINodeMetadata } from 'src/patchNetwork/midiNode';
import { writable, type Writable } from 'svelte/store';

const noop = () => {};

/**
 * A `CustomAudioNode` that implements all node types, allowing it to be used as a placeholder node for situations such
 * as loading and lazy initialization.
 */
export default class DummyNode extends GainNode implements AudioNode, MIDINode {
  protected connectedInputs: MIDINode[] = [];
  protected connectedOutputs: MIDINode[] = [];

  public name = '';

  constructor(name?: string) {
    super(new AudioContext());
    if (name) {
      this.name = name;
    }

    this.inputCbs = Object.freeze({
      onAttack: () => {},
      onRelease: () => {},
      onPitchBend: () => {},
      onClearAll: () => {},
      __dummyNodeName: this.name,
    } as MIDIInputCbs);
    this.cachedInputCbs = this.inputCbs;
  }

  public outputCbs = [];
  private outputCbs_: MIDIInputCbs[] = [];

  private cachedInputCbs: MIDIInputCbs;
  private inputCbs: MIDIInputCbs;
  public onAttack = () => {};
  public onRelease = () => {};
  public clearAll = () => {};

  public onConnectionsChanged = () => {};

  public metadata: Writable<MIDINodeMetadata> = writable({ noteMetadata: new Map() });

  public getInputCbs = () => this.inputCbs;

  public connect(destinationNode: any) {
    return destinationNode;
  }

  public disconnect() {}
}
