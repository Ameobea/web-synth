import { Map as ImmMap } from 'immutable';

import { buildBandSplitterPreset } from 'src/filterDesigner/presets';
import { connectFilterChain, setFilter } from 'src/filterDesigner/util';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import BandSplitterSmallView, {
  type BandSplitterSmallViewProps,
} from 'src/graphEditor/nodes/CustomAudio/BandSplitter/BandSplitterSmallView';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';

export interface SerializedBandSplitterNode {
  gains: [number, number, number];
}

const buildDefaultSerializedBandSplitterNode = (): SerializedBandSplitterNode => ({
  gains: [1, 1, 1],
});

export default class BandSplitterNode implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private inputGainNode: GainNode;
  private gainParams: [OverridableAudioParam, OverridableAudioParam, OverridableAudioParam];
  private outputGainNodes: [GainNode, GainNode, GainNode];
  private filterChains: [BiquadFilterNode[], BiquadFilterNode[], BiquadFilterNode[]];

  static typeName = 'Band Splitter';
  public nodeType = 'customAudio/bandSplitter';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, providedParams?: SerializedBandSplitterNode) {
    this.ctx = ctx;
    this.vcId = vcId;

    this.inputGainNode = ctx.createGain();
    this.outputGainNodes = [this.ctx.createGain(), this.ctx.createGain(), this.ctx.createGain()];
    this.outputGainNodes.forEach(node => {
      node.gain.value = 0;
    });
    this.gainParams = [
      new OverridableAudioParam(ctx, this.outputGainNodes[0].gain),
      new OverridableAudioParam(ctx, this.outputGainNodes[1].gain),
      new OverridableAudioParam(ctx, this.outputGainNodes[2].gain),
    ];
    this.gainParams.forEach(param => {
      param.manualControl.offset.value = 1;
    });

    const params = providedParams ?? buildDefaultSerializedBandSplitterNode();
    if (params) {
      this.deserialize(params);
    }

    this.filterChains = buildBandSplitterPreset().filterGroups.map((group, bandIx) => {
      const constructedFilters = group.map(params => {
        const filter = new BiquadFilterNode(ctx);
        setFilter(filter, undefined, params, params.frequency);
        return filter;
      });

      connectFilterChain(constructedFilters);
      this.inputGainNode.connect(constructedFilters[0]);
      constructedFilters[constructedFilters.length - 1].connect(this.outputGainNodes[bandIx]);
      return constructedFilters;
    }) as [BiquadFilterNode[], BiquadFilterNode[], BiquadFilterNode[]];

    this.renderSmallView = mkContainerRenderHelper({
      Comp: BandSplitterSmallView,
      getProps: (): BandSplitterSmallViewProps => ({
        initialState: this.serialize(),
        onChange: this.deserialize,
      }),
    });
    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  public serialize = (): SerializedBandSplitterNode => {
    return {
      gains: this.gainParams.map(param => param.manualControl.offset.value) as [
        number,
        number,
        number
      ],
    };
  };

  private deserialize = (params: SerializedBandSplitterNode) => {
    params.gains?.forEach((gain, i) => {
      this.gainParams[i].manualControl.offset.value = gain;
    });
  };

  public buildConnectables() {
    return {
      inputs: ['low', 'mid', 'high'].reduce(
        (acc, bandName, bandIx) =>
          acc.set(`${bandName} band gain`, { type: 'number', node: this.gainParams[bandIx] }),
        ImmMap<string, ConnectableInput>().set('input', {
          type: 'customAudio',
          node: this.inputGainNode,
        })
      ),
      outputs: ['low', 'mid', 'high'].reduce(
        (acc, bandName, bandIx) =>
          acc.set(`${bandName} band`, { type: 'customAudio', node: this.outputGainNodes[bandIx] }),
        ImmMap<string, ConnectableOutput>()
      ),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
