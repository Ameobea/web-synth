import { Map } from 'immutable';
import * as R from 'ramda';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';

export class LFONode implements ForeignNode {
  private vcId: string;
  public gainNode: GainNode;
  public oscillatorNode: OscillatorNode;
  public nodeType = 'customAudio/LFO';
  public name = 'LFO';

  private frequencyOverrideCSN: ConstantSourceNode;
  private amplitudeOverrideCSN: ConstantSourceNode;

  /**
   * See the docs for `enhanceAudioNode`.
   */
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  };

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.gainNode = new GainNode(ctx);
    this.oscillatorNode = new OscillatorNode(ctx);

    // These will always be connected, even if this node is disconnected.  So, if we ever want to garbage collect
    // the inner `oscillatorNode` and `gainNode`, they will have to be disconnected explicitly.
    this.oscillatorNode.connect(this.gainNode);
    this.oscillatorNode.start();

    this.frequencyOverrideCSN = new ConstantSourceNode(ctx);
    this.amplitudeOverrideCSN = new ConstantSourceNode(ctx);

    this.paramOverrides = {
      frequency: {
        param: new OverridableAudioParam(
          ctx,
          this.oscillatorNode.frequency,
          this.frequencyOverrideCSN,
          true
        ),
        override: this.frequencyOverrideCSN,
      },
      amplitude: {
        param: new OverridableAudioParam(ctx, this.gainNode.gain, this.amplitudeOverrideCSN, true),
        override: this.amplitudeOverrideCSN,
      },
    };

    if (!params) {
      return;
    }

    if (!R.isNil(params.gain)) {
      this.amplitudeOverrideCSN.offset.value = params.gain;
    }
    if (!R.isNil(params.frequency)) {
      this.frequencyOverrideCSN.offset.value = params.frequency;
    }
  }

  public serialize(): { [key: string]: any } {
    return {
      gain: this.paramOverrides.amplitude.override.offset.value,
      frequency: this.paramOverrides.frequency.override.offset.value,
    };
  }

  public buildConnectables(): AudioConnectables & { node: ForeignNode } {
    return {
      vcId: this.vcId,
      inputs: Map<string, ConnectableInput>()
        .set('frequency', {
          node: this.paramOverrides.frequency.param,
          type: 'number',
        })
        .set('amplitude', { node: this.paramOverrides.amplitude.param, type: 'number' }),
      outputs: Map<string, ConnectableOutput>().set('signal', {
        node: this.gainNode,
        type: 'number',
      }),
      node: this,
    };
  }
}
