import * as R from 'ramda';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import type { AudioConnectables } from 'src/patchNetwork';
import {
  buildDefaultLFOConfig,
  LFOInstance,
  type LFOConfig,
} from 'src/graphEditor/nodes/CustomAudio/LFONode/LFOInstance';
import LfoNodeSmallView from 'src/graphEditor/nodes/CustomAudio/LFONode/LFONodeUI/LFONodeSmallView.svelte';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';

export interface LegacyLFOParams {
  frequency: number;
  waveform: OscillatorType;
}

export class LFONode implements ForeignNode {
  public lfoInst: LFOInstance;
  public nodeType = 'customAudio/LFO';
  static typeName = 'LFO';

  /**
   * See the docs for `enhanceAudioNode`.
   */
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: LFOConfig | LegacyLFOParams | null) {
    this.lfoInst = new LFOInstance(ctx, vcId, this, params ?? buildDefaultLFOConfig());

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: LfoNodeSmallView,
      getProps: () => ({ inst: this.lfoInst }),
    });
    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });
  }

  public serialize(): LFOConfig {
    return R.clone(this.lfoInst.state.current);
  }

  public buildConnectables(): AudioConnectables & { node: ForeignNode } {
    return this.lfoInst.buildAudioConnectables();
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
