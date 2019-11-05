import { Map } from 'immutable';

import {
  AudioConnectables,
  updateConnectables,
  ConnectableInput,
  ConnectableOutput,
} from 'src/patchNetwork';

export class MixerNode {
  private gainNodes: GainNode[];
  private outputNode: GainNode;
  private vcId: string;
  private ctx: AudioContext;

  public nodeType = 'customAudio/mixer';
  public name = 'Mixer';
  public node: GainNode;

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;
    this.gainNodes = [new GainNode(ctx), new GainNode(ctx)];
    this.outputNode = new GainNode(ctx);
    this.node = this.outputNode;

    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        if (key === 'gains') {
          if (!Array.isArray(val)) {
            console.log('Invalid `params.gains` value supplied: ', val);
            return;
          }
          const gains = val as number[];
          while (this.gainNodes.length < gains.length) {
            this.addInput();
          }

          gains.forEach((gain, i) => {
            // TODO: Sync these to the LG node somehow?
            this.gainNodes[i].gain.value = gain;
          });
        }
      });
    }
  }

  public addInput() {
    const newGain = new GainNode(this.ctx);
    newGain.connect(this.outputNode);
    this.gainNodes.push(newGain);
    updateConnectables(this.vcId, this.buildConnectables());
  }

  public removeInput() {
    if (this.gainNodes.length <= 1) {
      return;
    }

    const removedGain = this.gainNodes.pop()!;
    removedGain.disconnect(this.outputNode);
    // Don't disconnect any incoming connections to this input; those will be trimmed by the graph diffing.
    updateConnectables(this.vcId, this.buildConnectables());
  }

  public buildConnectables(): AudioConnectables & { node: NonNullable<AudioConnectables['node']> } {
    return {
      inputs: this.gainNodes.reduce(
        (acc, gainNode, i) =>
          acc
            .set(`Input ${i}`, { type: 'customAudio', node: gainNode })
            .set(`Input ${i} Gain`, { type: 'number', node: gainNode.gain }),
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

  public serialize() {
    return {
      gains: this.gainNodes.map(node => node.gain.value),
    };
  }
}
