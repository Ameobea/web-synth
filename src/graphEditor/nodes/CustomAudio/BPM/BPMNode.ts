import { Map as ImmMap } from 'immutable';
import { globalTempoCSN } from 'src/globalMenu';
import BpmNodeSmallView from 'src/graphEditor/nodes/CustomAudio/BPM/BPMNodeSmallView.svelte';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';

export class BPMNode implements ForeignNode {
  private vcId: string | undefined;

  static typeName = 'BPM';
  public nodeType = 'customAudio/bpm';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(_ctx: AudioContext, vcId?: string, _params?: { [key: string]: any } | null) {
    this.vcId = vcId;

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: BpmNodeSmallView,
      getProps: () => ({}),
    });

    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });
  }

  public serialize(): { [key: string]: any } {
    return {};
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>(),
      outputs: ImmMap<string, ConnectableOutput>().set('bpm', {
        type: 'number',
        node: globalTempoCSN,
      }),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
