import * as R from 'ramda';
import { Option } from 'funfix-core';

/**
 * Swaps out the auido node for an instance with a new one.  Disconnects the old one from all inputs
 * and outputs and then connects the new one in the same way.
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
  console.log({ nodeInstance });

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
