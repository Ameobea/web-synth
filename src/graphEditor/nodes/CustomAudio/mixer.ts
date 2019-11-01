import { Map } from 'immutable';

import { AudioConnectables, updateConnectables } from 'src/patchNetwork';

const ctx = new AudioContext();

export class MixerNode {
  private gainNodes: GainNode[] = [new GainNode(ctx), new GainNode(ctx)];
  private outputNode = new GainNode(ctx);
  private vcId: string;

  constructor(vcId: string) {
    this.vcId = vcId;
  }

  public addInput() {
    const newGain = new GainNode(ctx);
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

  public buildConnectables(): AudioConnectables {
    return {
      inputs: this.gainNodes.reduce(
        (acc, gainNode, i) =>
          acc
            .set(`Input ${i}`, { type: 'customAudio', node: gainNode })
            .set(`Input ${i} Gain`, { type: 'number', node: gainNode.gain }),
        Map<string, { node: AudioNode | AudioParam; type: string }>().set('Master Gain', {
          node: this.outputNode.gain,
          type: 'number',
        })
      ),
      outputs: Map<string, { node: AudioNode; type: string }>().set('output', {
        node: this.outputNode,
        type: 'customAudio',
      }),
      vcId: this.vcId,
    };
  }
}
