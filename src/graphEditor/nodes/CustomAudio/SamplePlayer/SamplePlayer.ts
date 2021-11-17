import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import SamplePlayerUI from 'src/graphEditor/nodes/CustomAudio/SamplePlayer/SamplePlayerUI';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import type { SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';

interface SamplePlayerSampleDescriptor {
  descriptor: SampleDescriptor;
  sample: AudioBuffer | null;
  gain: number;
}

interface SerializedSamplePlayer {
  sampleDescriptors: Omit<SamplePlayerSampleDescriptor, 'sample'>[];
}

export default class SamplePlayerNode implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private sampleDescriptors: SamplePlayerSampleDescriptor[] = [];

  static typeName = 'Sample Player';
  public nodeType = 'customAudio/samplePlayer';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    if (params) {
      this.deserialize(params);
    }

    const props = {
      addSample: this.addSample.bind(this),
      removeSample: this.removeSample.bind(this),
    };
    this.renderSmallView = mkContainerRenderHelper({
      Comp: SamplePlayerUI,
      getProps: () => props,
    });
    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  private addSample(descriptor: SampleDescriptor) {
    // TODO
  }

  private removeSample(index: number) {
    // TODO
  }

  private deserialize(params: { [key: string]: any }) {
    // TODO
  }

  public serialize(): SerializedSamplePlayer {
    return { sampleDescriptors: this.sampleDescriptors.map(R.omit(['sample'])) };
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>(),
      outputs: ImmMap<string, ConnectableOutput>(),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
