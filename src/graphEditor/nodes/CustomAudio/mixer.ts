import { Map } from 'immutable';

import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';

export class MixerNode {
  private gainNodes: GainNode[];
  private outputNode: GainNode;
  private vcId: string;
  private ctx: AudioContext;

  public nodeType = 'customAudio/mixer';
  static typeName = 'Mixer';
  public node: GainNode;

  /**
   * See the docs for `enhanceAudioNode`.
   */
  paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  private updateParamOverrides() {
    this.paramOverrides = this.gainNodes.reduce((acc, gainNode, i) => {
      // Re-use existing entries if they exist
      const name = `Input ${i} Gain`;
      if (this.paramOverrides[name]) {
        return { ...acc, [name]: this.paramOverrides[name] };
      }

      // Create new entries as needed
      const csn = new ConstantSourceNode(this.ctx);
      csn.start();
      return {
        ...acc,
        [name]: { param: new OverridableAudioParam(this.ctx, gainNode.gain, csn, true) },
      };
    }, {});
  }

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;
    this.gainNodes = [new GainNode(ctx), new GainNode(ctx)];
    this.outputNode = new GainNode(ctx);
    this.node = this.outputNode;

    this.updateParamOverrides();
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

          this.updateParamOverrides();

          gains.forEach((gain, i) => {
            // Set the value of the overrides for each of the
            this.paramOverrides[`Input ${i} Gain`].override.offset.value = gain;
          });
        }
      });
    }
  }

  public addInput() {
    const newGain = new GainNode(this.ctx);
    newGain.connect(this.outputNode);
    this.gainNodes.push(newGain);
    this.updateParamOverrides();
    updateConnectables(this.vcId, this.buildConnectables());
  }

  public removeInput() {
    if (this.gainNodes.length <= 1) {
      return;
    }

    const removedGain = this.gainNodes.pop()!;
    // Don't disconnect any incoming connections to this input; those will be trimmed by the graph diffing.
    // Only disconnect the internal connection.
    removedGain.disconnect(this.outputNode);
    this.updateParamOverrides();
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
              node: this.paramOverrides[`Input ${i} Gain`].param,
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

  public serialize() {
    return {
      gains: this.gainNodes.map(
        (_node, i) => this.paramOverrides[`Input ${i} Gain`].override.offset.value
      ),
    };
  }
}
