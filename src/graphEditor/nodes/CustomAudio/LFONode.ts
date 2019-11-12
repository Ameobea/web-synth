import { Map } from 'immutable';
import * as R from 'ramda';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';

export class LFONode implements ForeignNode {
  private vcId: string;
  public gainNode: GainNode;
  public oscillatorNode: OscillatorNode;
  public nodeType = 'customAudio/LFO';
  public name = 'LFO';

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.gainNode = new GainNode(ctx);
    this.oscillatorNode = new OscillatorNode(ctx);

    // These will always be connected, even if this node is disconnected.  So, if we ever want to garbage collect
    // the inner `oscillatorNode` and `gainNode`, they will have to be disconnected explicitly.
    this.oscillatorNode.connect(this.gainNode);
    this.oscillatorNode.start();

    console.log({ osc: this.oscillatorNode, gain: this.gainNode });

    if (!params) {
      return;
    }

    if (!R.isNil(params.gain)) {
      this.gainNode.gain.value = params.gain;
    }
    if (!R.isNil(params.frequency)) {
      this.oscillatorNode.frequency.value = params.frequency;
    }
  }

  public serialize(): { [key: string]: any } {
    return {
      gain: this.gainNode.gain.value,
      frequency: this.oscillatorNode.frequency.value,
    };
  }

  public buildConnectables(): AudioConnectables & { node: ForeignNode } {
    return {
      vcId: this.vcId,
      inputs: Map<string, ConnectableInput>()
        .set('frequency', {
          node: this.oscillatorNode.frequency,
          type: 'number',
        })
        .set('amplitude', { node: this.gainNode.gain, type: 'number' }),
      outputs: Map<string, ConnectableOutput>().set('signal', {
        node: this.gainNode,
        type: 'number',
      }),
      node: this,
    };
  }
}
