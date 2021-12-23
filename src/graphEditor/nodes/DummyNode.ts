/* eslint-disable @typescript-eslint/no-empty-function */
import type { MIDIInputCbs, MIDINode } from 'src/patchNetwork/midiNode';

const noop = () => {};

/**
 * A `CustomAudioNode` that implements all node types, allowing it to be used as a placeholder node for situations such
 * as loading and lazy initialization.
 */
export default class DummyNode extends GainNode implements AudioNode, MIDINode {
  constructor() {
    super(new AudioContext());
  }

  public outputCbs = [];
  private outputCbs_: MIDIInputCbs[] = [];

  private cachedInputCbs = {
    onAttack: () => {},
    onRelease: () => {},
    onPitchBend: () => {},
    onClearAll: () => {},
  };
  private inputCbs = {
    onAttack: () => {},
    onRelease: () => {},
    onPitchBend: () => {},
    onClearAll: () => {},
  };
  public onAttack = () => {};
  public onRelease = () => {};
  public clearAll = () => {};

  public getInputCbs = () => ({
    onAttack: noop,
    onRelease: noop,
    onPitchBend: noop,
    onClearAll: noop,
  });

  public connect(destinationNode: any) {
    return destinationNode;
  }

  public disconnect() {}
}
