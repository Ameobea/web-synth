import { Map as ImmMap } from 'immutable';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput } from 'src/patchNetwork';

export class AddNode implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;

  static typeName = 'Quantizer';
  public nodeType = 'customAudio/quantizer';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, _params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;
  }

  public serialize(): { [key: string]: any } {
    return {};
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>().set('input', {
        type: 'number',
        node: this.awpHandle
          ? (this.awpHandle.parameters as Map<string, AudioParam>).get('input')!
          : new DummyNode(),
      }),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        type: 'number',
        node: this.awpHandle ? this.awpHandle : new DummyNode(),
      }),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
