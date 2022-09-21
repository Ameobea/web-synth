import { Map } from 'immutable';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import MixerSmallView from 'src/graphEditor/nodes/CustomAudio/mixer/MixerSmallView';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';

export class MixerNode {
  private gainNodes: GainNode[];
  public gainParams: OverridableAudioParam[];
  private outputNode: GainNode;
  private vcId: string;
  private ctx: AudioContext;

  public nodeType = 'customAudio/mixer';
  static typeName = 'Mixer';
  public node: GainNode;

  // unused but exists to match interface
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;
    this.outputNode = new GainNode(ctx);
    this.gainNodes = [new GainNode(ctx), new GainNode(ctx)];
    this.gainNodes.forEach(gain => gain.connect(this.outputNode));
    this.gainParams = this.gainNodes.map(gain => new OverridableAudioParam(ctx, gain.gain));
    this.node = this.outputNode;
    this.renderSmallView = mkContainerRenderHelper({
      Comp: MixerSmallView,
      getProps: () => ({ mixer: this }),
    });
    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });

    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        if (key === 'gains') {
          if (!Array.isArray(val)) {
            console.error('Invalid `params.gains` value supplied: ', val);
            return;
          }
          const gains = val as number[];
          while (this.gainNodes.length < gains.length) {
            this.addInput();
          }

          gains.forEach((gain, i) => {
            // Set the value of the overrides for each of the
            this.gainParams[i].manualControl.offset.value = gain;
          });
        }
      });
    }
  }

  public addInput() {
    const newGain = new GainNode(this.ctx);
    newGain.connect(this.outputNode);
    this.gainNodes.push(newGain);
    this.gainParams.push(new OverridableAudioParam(this.ctx, newGain.gain));
    updateConnectables(this.vcId, this.buildConnectables());
  }

  public removeInput() {
    if (this.gainNodes.length <= 1) {
      return;
    }

    const removedGain = this.gainNodes.pop()!;
    this.gainParams.pop();
    // Don't disconnect any incoming connections to this input; those will be trimmed by the graph diffing.
    // Only disconnect the internal connection.
    removedGain.disconnect(this.outputNode);
    updateConnectables(this.vcId, this.buildConnectables());
  }

  public buildConnectables(): AudioConnectables & { node: NonNullable<AudioConnectables['node']> } {
    return {
      inputs: this.gainNodes.reduce(
        (acc, gainNode, i) =>
          acc
            .set(`Input ${i}`, {
              type: 'customAudio',
              node: gainNode,
            })
            .set(`Input ${i} Gain`, {
              type: 'number',
              node: this.gainParams[i],
            }),
        Map<string, ConnectableInput>().set('Master Gain', {
          node: this.outputNode.gain,
          type: 'number',
        })
      ),
      outputs: Map<string, ConnectableOutput>().set('output', {
        node: this.outputNode,
        type: 'customAudio',
      }),
      vcId: this.vcId,
      node: this,
    };
  }

  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];

  public serialize() {
    return {
      gains: this.gainNodes.map((_node, i) => this.gainParams[i].manualControl.offset.value),
    };
  }
}
