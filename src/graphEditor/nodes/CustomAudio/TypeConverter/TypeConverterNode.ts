import { Map as ImmMap } from 'immutable';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';

export class TypeConverterNode implements ForeignNode {
  private vcId: string | undefined;
  private gain: GainNode;

  static typeName = 'Type Converter';
  public nodeType = 'customAudio/typeConverter';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, _params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.gain = new GainNode(ctx);
  }

  public serialize(): { [key: string]: any } {
    return {};
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>()
        .set('input audio', {
          type: 'customAudio',
          node: this.gain,
        })
        .set('input cv', {
          type: 'number',
          node: this.gain,
        }),
      outputs: ImmMap<string, ConnectableOutput>()
        .set('output audio', {
          type: 'customAudio',
          node: this.gain,
        })
        .set('output cv', {
          type: 'number',
          node: this.gain,
        }),
      vcId: this.vcId!,
      node: this,
    };
  }
}
