import * as R from 'ramda';
import { Option } from 'funfix-core';

/**
 * Swaps out the auido node for an instance with a new one.  Disconnects the old one from all inputs and outputs and
 * then connects the new one in the same way.  If the node passes through inputs or the override can be set by the
 * `setIsOverridden` method.
 */
export const swapAudioNodes = (
  nodeInstance: {
    audionode?: AudioNode;
    getInputNode: (slot: number) => undefined | null | { audionode?: AudioNode };
    getOutputNodes: (slot: number) => undefined | null | { audionode?: AudioNode }[];
  },
  newAudioNode: AudioNode
) => {
  // Dispose of the old audio node and replace it with the new one
  const oldAudioNode = nodeInstance.audionode;
  if (oldAudioNode) {
    oldAudioNode.disconnect();
  }
  nodeInstance.audionode = newAudioNode;

  // connect all inputs to the newly created audio node
  let i = 0;
  while (true) {
    const inputAudioNode = Option.of(nodeInstance.getInputNode(i))
      .map(R.prop('audionode'))
      .orNull();

    if (!inputAudioNode) {
      break;
    }

    inputAudioNode.connect(nodeInstance.audionode);
    i += 1;
  }

  // connect the newly created node to all outputs
  let slot = 0;
  while (true) {
    const outputNodesForSlot = nodeInstance.getOutputNodes(slot);
    if (!outputNodesForSlot) {
      break;
    }

    outputNodesForSlot.forEach(({ audionode: outputAudioNode }) => {
      if (!outputAudioNode || !nodeInstance.audionode) {
        return;
      }

      nodeInstance.audionode.connect(outputAudioNode);
    });

    slot += 1;
  }
};

export const createPassthroughNode = <T extends GainNode = GainNode>(
  Constructor: new (ctx: AudioContext) => T
): T => {
  const ctx = new AudioContext();
  const node = new Constructor(ctx);
  node.gain.setValueAtTime(1, ctx.currentTime);
  return node;
};

/**
 * Wraps an `AudioParm` with a switch that toggles between a `manualControl` input and everything connected to
 * the created `OverridableAudioParam` itself.
 */
export class OverridableAudioParam extends ConstantSourceNode implements AudioNode {
  /**
   * The `AudioParam` that we are handling inputs for.
   */
  private wrappedParam: AudioParam;
  /**
   * The `AudioNode` that is treated as the override for anything connected to this node.
   */
  private manualControl: AudioNode;
  /**
   * If `true`, then `manualControl` is connecte to `wrappedParam`.  If `false`, then anything connected to this
   * node itself is passed through to `wrappedParam`.
   */
  private isOverridden: boolean;

  constructor(
    ctx: AudioContext,
    wrappedParam: AudioParam,
    manualControl: AudioNode,
    defaultOverridden = false
  ) {
    super(ctx);
    this.start();
    // Operate as a pass-through node, passing on whatever values are input to the output if we are
    // not currently overridden.
    this.offset.value = 0;

    this.wrappedParam = wrappedParam;
    this.manualControl = manualControl;

    this.isOverridden = true;
    if (defaultOverridden) {
      manualControl.connect(wrappedParam);
    } else {
      this.connect(wrappedParam);
    }
  }

  /**
   * Sets whether the output of `manualControl` or the inputs to this node itself are passed through to `wrappedParam`.
   *
   * @param isOverridden If `true`, then the output of `manualControl` will be passed through to `wrappedParam`.  If
   * `false`, then whatever is connected to this node itself will be passed through to `wrappedParam`.
   */
  public setIsOverridden(isOverridden: boolean) {
    if (isOverridden === this.isOverridden) {
      return;
    }

    if (isOverridden) {
      this.disconnect(this.wrappedParam);
      this.manualControl.connect(this.wrappedParam);
    } else {
      this.manualControl.disconnect(this.wrappedParam);
      this.connect(this.wrappedParam);
    }
  }
}
