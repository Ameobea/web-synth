import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import SamplePlayerUI from 'src/graphEditor/nodes/CustomAudio/SamplePlayer/SamplePlayerUI';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { getSample, type SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';
import { getSentry } from 'src/sentry';
import { AsyncOnce, type ArrayElementOf } from 'src/util';

const SamplePlayerWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'sample_player.wasm?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ).then(res => res.arrayBuffer()),
  true
);
const SamplePlayerAWPRegistered = new AsyncOnce(
  () =>
    new AudioContext().audioWorklet.addModule(
      process.env.ASSET_PATH +
        'SamplePlayerAWP.js?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);

export interface SampleCrossfadeParams {
  enabled: boolean;
  threshold: number;
}

export interface SamplePlayerSampleDescriptor {
  id: string;
  descriptor: SampleDescriptor;
  sample: AudioBuffer | null;
  crossfadeParams: SampleCrossfadeParams;
  gain: number;
}

interface SerializedSamplePlayer {
  sampleDescriptors: Omit<SamplePlayerSampleDescriptor, 'sample'>[];
}

export default class SamplePlayerNode implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private sampleDescriptors: SamplePlayerSampleDescriptor[] = [];
  private inputGainNodes: { param: OverridableAudioParam }[] = [];
  private awpHandle: AudioWorkletNode | null = null;

  public listUsedSamples: () => SampleDescriptor[] = () =>
    this.sampleDescriptors.map(d => d.descriptor);

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

    this.renderSmallView = mkContainerRenderHelper({
      Comp: SamplePlayerUI,
      getProps: () => ({
        addSample: this.addSample.bind(this),
        removeSample: this.removeSample.bind(this),
        setSampleGain: this.setSampleGain.bind(this),
        setSampleCrossfadeParams: this.setSampleCrossfadeParams.bind(this),
        setSampleDescriptor: this.setSampleDescriptor.bind(this),
        initialState: [...this.sampleDescriptors],
      }),
    });
    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });

    this.init().catch(err => {
      console.error('Error initializing SamplePlayerNode', err);
      getSentry()?.captureException(err);
    });
  }

  private async init() {
    const [wasmBytes] = await Promise.all([
      SamplePlayerWasmBytes.get(),
      SamplePlayerAWPRegistered.get(),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'sample-player-awp', {
      numberOfOutputs: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });

    this.sampleDescriptors.forEach((sampleDescriptor, i) => {
      const gainOAP = new OverridableAudioParam(
        this.ctx,
        (this.awpHandle!.parameters as Map<string, AudioParam>).get(`sample_${i}_gain`)
      );
      gainOAP.manualControl.offset.value = sampleDescriptor.gain ?? 1;
      this.inputGainNodes.push({ param: gainOAP });
    });

    this.awpHandle.port.postMessage({
      type: 'setWasmBytes',
      wasmBytes,
      initialSampleDescriptors: this.sampleDescriptors.map(slot => ({
        gain: slot.gain,
        sampleData: slot.sample?.getChannelData(0),
        crossfadeParams: slot.crossfadeParams,
      })),
    });

    this.sampleDescriptors.forEach((desc, i) => {
      this.awpHandle!.port.postMessage({
        type: 'setSampleCrossfadeParams',
        voiceIx: i,
        enabled: desc.crossfadeParams.enabled,
        threshold: desc.crossfadeParams.threshold,
      });
    });

    if (!R.isNil(this.vcId)) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private async fetchAndSetSample(descriptor: SampleDescriptor) {
    const sample = await getSample(descriptor);

    this.sampleDescriptors
      .map((slot, i) => [slot, i] as const)
      .filter(([slot]) => slot.descriptor === descriptor)
      .forEach(([slot, slotIx]) => {
        slot.sample = sample;
        this.awpHandle?.port.postMessage({
          type: 'setSampleData',
          voiceIx: slotIx,
          sampleData: sample.getChannelData(0),
        });
      });
  }

  private addSample(
    descriptor: SampleDescriptor,
    id: string,
    gain?: number,
    crossfadeParams?: SampleCrossfadeParams
  ) {
    this.sampleDescriptors.push({
      id,
      descriptor,
      sample: null,
      gain: gain ?? 1,
      crossfadeParams: crossfadeParams ?? {
        enabled: false,
        threshold: 0,
      },
    });

    if (this.awpHandle) {
      const gainOAP = new OverridableAudioParam(
        this.ctx,
        (this.awpHandle.parameters as Map<string, AudioParam>).get(
          `sample_${this.sampleDescriptors.length - 1}_gain`
        )
      );
      gainOAP.manualControl.offset.value = gain ?? 1;
      this.inputGainNodes.push({ param: gainOAP });

      this.awpHandle.port.postMessage({ type: 'addSample', sample: { gain: gain ?? 1 } });
    }

    this.fetchAndSetSample(descriptor);
    if (!R.isNil(this.vcId)) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private setSampleCrossfadeParams(voiceIx: number, crossfadeParams: SampleCrossfadeParams) {
    this.sampleDescriptors[voiceIx].crossfadeParams = crossfadeParams;

    this.awpHandle?.port.postMessage({
      type: 'setSampleCrossfadeParams',
      voiceIx,
      enabled: crossfadeParams.enabled,
      threshold: crossfadeParams.threshold,
    });
  }

  private removeSample(index: number) {
    this.sampleDescriptors = R.remove(index, 1, this.sampleDescriptors);

    this.awpHandle?.port.postMessage({ type: 'removeSample', voiceIx: index });

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
        (descriptor: ArrayElementOf<SerializedSamplePlayer['sampleDescriptors']>) => {
          if (!descriptor.crossfadeParams) {
            descriptor.crossfadeParams = {
              enabled: false,
              threshold: 0,
            };
          }
          this.addSample(
            descriptor.descriptor,
            btoa(Math.random().toString()),
            descriptor.gain,
            descriptor.crossfadeParams
          );
        }
      );
    }
  }

  public serialize(): SerializedSamplePlayer {
    return { sampleDescriptors: this.sampleDescriptors.map(R.omit(['sample'])) };
  }

  public buildConnectables() {
    const outputs = ImmMap<string, ConnectableOutput>().set('output', {
      type: 'customAudio',
      node: this.awpHandle ?? new DummyNode(),
    });

    return {
      inputs: R.range(0, this.sampleDescriptors.length).reduce(
        (acc, i) =>
          acc
            .set(`sample_${i}_gain`, {
              type: 'number',
              node: this.inputGainNodes[i]?.param ?? new DummyNode(),
            })
            .set(`sample_${i}_gate`, {
              type: 'number',
              node:
                (this.awpHandle?.parameters as Map<string, AudioParam> | undefined)?.get(
                  `sample_${i}_gate`
                ) ?? new DummyNode(),
            }),
        ImmMap<string, ConnectableInput>()
      ),
      outputs,
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
