import { Option } from 'funfix-core';
import * as R from 'ramda';

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

const buildManualControl = (ctx: AudioContext) => {
  const manualControl = new ConstantSourceNode(ctx);
  manualControl.offset.value = 0;
  manualControl.start();
  return manualControl;
};

/**
 * Wraps an `AudioParm` with a switch that toggles between a `manualControl` input and everything connected to
 * the created `OverridableAudioParam` itself.
 */
export class OverridableAudioParam extends GainNode implements AudioNode {
  private ctx: AudioContext;
  /**
   * The `AudioParam` that we are handling inputs for.
   */
  public wrappedParam: AudioParam;
  public outputCSN: ConstantSourceNode | null = null;
  /**
   * The `AudioNode` that is treated as the override for anything connected to this node.
   */
  public manualControl: ConstantSourceNode;
  /**
   * If `true`, then `manualControl` is connected to `wrappedParam`.  If `false`, then anything connected to this
   * node itself is passed through to `wrappedParam`.
   */
  private isOverridden: boolean;

  constructor(
    ctx: AudioContext,
    wrappedParam?: AudioParam,
    manualControl?: ConstantSourceNode,
    defaultOverridden = true
  ) {
    super(ctx);
    // Operate as a pass-through node, passing on whatever values are input to the output if we are
    // not currently overridden.
    this.gain.value = 1;
    this.ctx = ctx;

    this.wrappedParam = wrappedParam || this.buildWrappedParam();
    this.manualControl = manualControl || buildManualControl(ctx);

    this.isOverridden = defaultOverridden;
    if (defaultOverridden) {
      this.manualControl.connect(this.wrappedParam);
    } else {
      this.connect(this.wrappedParam);
    }
  }

  private buildWrappedParam = () => {
    const node = new ConstantSourceNode(this.ctx);
    node.offset.value = 0;
    node.start();
    this.outputCSN = node;
    return node.offset;
  };

  /**
   * Sets whether the output of `manualControl` or the inputs to this node itself are passed through to `wrappedParam`.
   *
   * This is called automatically by the VCM when dis/connecting `OverridableAudioParam`s that are managed by it.
   *
   * @param isOverridden If `true`, then the output of `manualControl` will be passed through to `wrappedParam`.  If
   * `false`, then whatever is connected to this node itself will be passed through to `wrappedParam`.
   */
  public setIsOverridden(isOverridden: boolean) {
    if (isOverridden === this.isOverridden) {
      return;
    }

    this.isOverridden = isOverridden;

    if (isOverridden) {
      this.disconnect(this.wrappedParam);
      this.manualControl.connect(this.wrappedParam);
    } else {
      this.manualControl.disconnect(this.wrappedParam);
      this.connect(this.wrappedParam);
    }

    this.overrideStatusChangeCbs.forEach(cb => cb(isOverridden));
  }

  public getIsOverridden(): boolean {
    return this.isOverridden;
  }

  private overrideStatusChangeCbs: ((isOverridden: boolean) => void)[] = [];
  public registerOverrideStatusChangeCb(cb: (isOverridden: boolean) => void) {
    this.overrideStatusChangeCbs.push(cb);
  }

  public deregisterOverrideStatusChangeCb(cb: (isOverridden: boolean) => void) {
    this.overrideStatusChangeCbs = this.overrideStatusChangeCbs.filter(c => c !== cb);
  }

  /**
   * Replaces the currently wrapped param with the new one provided, disconnecting the old one and re-connecting the new
   * one in its place.
   */
  public replaceParam(newParam: AudioParam) {
    if (this.isOverridden) {
      this.manualControl.disconnect(this.wrappedParam);
    } else {
      this.disconnect(this.wrappedParam);
    }
    this.wrappedParam = newParam;
    if (this.isOverridden) {
      this.manualControl.connect(this.wrappedParam);
    } else {
      this.connect(this.wrappedParam);
    }
  }

  public dispose() {
    this.disconnect();
    if (this.isOverridden) {
      this.manualControl.disconnect(this.wrappedParam);
    }
    if (this.outputCSN) {
      this.outputCSN.disconnect();
    }
  }
}

/**
 * Similar to `OverridableAudioParam`, but instead of wrapping an `AudioParam` directly, it outputs the passthrough or
 * override value on itself.
 */
export class OverridableAudioNode extends GainNode {
  public manualControl: ConstantSourceNode;
  private isOverridden: boolean;
  public output: GainNode;

  constructor(ctx: AudioContext, manualControl?: ConstantSourceNode, defaultOverridden = true) {
    super(ctx);

    this.manualControl = manualControl || buildManualControl(ctx);
    this.isOverridden = defaultOverridden;
    this.output = new GainNode(ctx);
    this.output.gain.value = 1;

    if (defaultOverridden) {
      this.manualControl.connect(this.output);
    } else {
      this.connect(this.output);
    }
    this.isOverridden = defaultOverridden;
  }

  public getIsOverridden(): boolean {
    return this.isOverridden;
  }

  public setIsOverridden(isOverridden: boolean) {
    if (isOverridden === this.isOverridden) {
      return;
    }

    this.isOverridden = isOverridden;

    if (isOverridden) {
      this.disconnect(this.output);
      this.manualControl.connect(this.output);
    } else {
      this.manualControl.disconnect(this.output);
      this.connect(this.output);
    }
  }
}
