import type { ArrayElementOf } from 'ameo-utils/types';
import { Map as ImmMap } from 'immutable';
import { updateConnectables } from 'index';
import * as R from 'ramda';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import SamplePlayerUI from 'src/graphEditor/nodes/CustomAudio/SamplePlayer/SamplePlayerUI';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { getSample, SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';
import { AsyncOnce } from 'src/util';

export const DelayWasmBytes = new AsyncOnce(() =>
  fetch(
    '/sample_player.wasm?cacheBust=' + window.location.host.includes('localhost')
      ? ''
      : btoa(Math.random().toString())
  ).then(res => res.arrayBuffer())
);

export interface SamplePlayerSampleDescriptor {
  id: string;
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
  private inputGainNodes: { param: OverridableAudioParam; node: GainNode }[] = [];
  private awpHandle: AudioWorkletNode | null = null;

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
      setSampleGain: this.setSampleGain.bind(this),
      setSampleDescriptor: this.setSampleDescriptor.bind(this),
      initialState: [...this.sampleDescriptors],
    };
    this.renderSmallView = mkContainerRenderHelper({
      Comp: SamplePlayerUI,
      getProps: () => props,
    });
    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });

    this.init();
  }

  private async init() {
    const [wasmBytes] = await Promise.all([
      DelayWasmBytes.get(),
      this.ctx.audioWorklet.addModule(
        '/SamplePlayerAWP.js?cacheBust=' +
          (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
      ),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'sample-player-awp', { numberOfOutputs: 1 });

    this.awpHandle.port.postMessage({
      type: 'setWasmBytes',
      initialSampleDescriptors: this.sampleDescriptors.map(slot => ({
        gain: slot.gain,
        sampleData: slot.sample?.getChannelData(0),
      })),
    });

    if (!R.isNil(this.vcId)) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private fetchAndSetSample(descriptor: SampleDescriptor) {
    getSample(descriptor).then(sample =>
      this.sampleDescriptors
        .map((slot, i) => [slot, i] as const)
        .filter(([slot]) => R.propEq('descriptor', descriptor, slot))
        .forEach(([slot, slotIx]) => {
          slot.sample = sample;
          this.awpHandle?.port.postMessage({
            type: 'setSampleData',
            voiceIx: slotIx,
            sampleData: sample.getChannelData(0),
          });
        })
    );
  }

  private addSample(descriptor: SampleDescriptor, id: string, gain?: number) {
    this.sampleDescriptors.push({ id, descriptor, sample: null, gain: gain ?? 1 });

    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 0;
    const gainOAP = new OverridableAudioParam(this.ctx, gainNode.gain);
    gainOAP.manualControl.offset.value = gain ?? 1;
    this.inputGainNodes.push();
    this.inputGainNodes.push({ param: gainOAP, node: gainNode });

    this.fetchAndSetSample(descriptor);
    if (!R.isNil(this.vcId)) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private removeSample(index: number) {
    this.sampleDescriptors = R.remove(index, 1, this.sampleDescriptors);
    if (!R.isNil(this.vcId)) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private setSampleGain(index: number, gain: number) {
    this.sampleDescriptors[index].gain = gain;
    this.inputGainNodes[index].param.manualControl.offset.value = gain;
  }

  private setSampleDescriptor(index: number, descriptor: SampleDescriptor) {
    this.sampleDescriptors[index].descriptor = descriptor;
    this.sampleDescriptors[index].sample = null;
    this.fetchAndSetSample(descriptor);
  }

  private deserialize(params: { [key: string]: any }) {
    if (params.sampleDescriptors) {
      params.sampleDescriptors.forEach(
        (descriptor: ArrayElementOf<SerializedSamplePlayer['sampleDescriptors']>) =>
          this.addSample(descriptor.descriptor, btoa(Math.random().toString()), descriptor.gain)
      );
    }
  }

  public serialize(): SerializedSamplePlayer {
    return { sampleDescriptors: this.sampleDescriptors.map(R.omit(['sample'])) };
  }

  public buildConnectables() {
    return {
      inputs: this.inputGainNodes.reduce(
        (acc, inputGain, i) =>
          acc.set(`sample_${i}_gain`, { type: 'number', node: inputGain.param }),
        ImmMap<string, ConnectableInput>()
      ),
      outputs: ImmMap<string, ConnectableOutput>(),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
