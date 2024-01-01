import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import { get, writable, type Writable } from 'svelte/store';

import { buildVocoderBandpassChainPreset } from 'src/filterDesigner/vocoder';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import VocoderSmallView from 'src/graphEditor/nodes/CustomAudio/Vocoder/VocoderSmallView.svelte';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { getSentry } from 'src/sentry';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { AsyncOnce, dbToLinear } from 'src/util';

const VocoderWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'vocoder.wasm?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);

const ctx = new AudioContext();
const VocoderAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'VocoderAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ),
  true
);

export interface VocoderState {
  carrierGainDb: number;
  modulatorGainDb: number;
  postGainDb: number;
}

const buildDefaultVocoderState = (): VocoderState => ({
  carrierGainDb: 0,
  modulatorGainDb: 0,
  postGainDb: 0,
});

export class VocoderNode implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private awpHandle: AudioWorkletNode | null = null;
  private store: Writable<VocoderState>;
  private carrierInput: GainNode;
  private modulatorInput: GainNode;
  private carrierGain: OverridableAudioParam;
  private modulatorGain: OverridableAudioParam;
  private postGain: OverridableAudioParam;

  static typeName = 'Vocoder';
  public nodeType = 'customAudio/vocoder';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: Record<string, any> | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    this.carrierInput = new GainNode(ctx);
    this.modulatorInput = new GainNode(ctx);

    this.store = writable(this.deserialize(params));

    this.carrierGain = new OverridableAudioParam(ctx);
    this.modulatorGain = new OverridableAudioParam(ctx);
    this.postGain = new OverridableAudioParam(ctx);

    this.handleStateChange(get(this.store));

    this.init().catch(err => {
      console.error('Error initializing VocoderNode', err);
      getSentry()?.captureException(err);
    });

    let unsubscriber: (() => void) | null = null;
    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: VocoderSmallView,
      getProps: () => ({ store: this.store }),
      predicate: () => {
        unsubscriber = this.store.subscribe(newState => this.handleStateChange(newState));
      },
    });

    this.cleanupSmallView = mkSvelteContainerCleanupHelper({
      preserveRoot: true,
      predicate: () => unsubscriber?.(),
    });
  }

  private handleStateChange(newState: VocoderState) {
    this.carrierGain.manualControl.offset.value = dbToLinear(newState.carrierGainDb);
    this.modulatorGain.manualControl.offset.value = dbToLinear(newState.modulatorGainDb);
    this.postGain.manualControl.offset.value = dbToLinear(newState.postGainDb);
  }

  private buildAndEncoderFilterParams(): Float32Array {
    const params = buildVocoderBandpassChainPreset(16);
    const groupCount = params.filterGroups.length;
    const filtersPerGroup = params.filterGroups[0].length;
    // buf format: [cutoffFreq, Q]
    const buf = new Float32Array(groupCount * filtersPerGroup * 2);
    for (let groupIx = 0; groupIx < groupCount; groupIx++) {
      for (let filterIx = 0; filterIx < filtersPerGroup; filterIx++) {
        const filter = params.filterGroups[groupIx][filterIx];
        const i = groupIx * filtersPerGroup * 2 + filterIx * 2;
        buf[i] = filter.frequency;
        buf[i + 1] = filter.Q ?? 1;
      }
    }
    return buf;
  }

  private async init() {
    const [wasmBytes] = await Promise.all([
      VocoderWasmBytes.get(),
      VocoderAWPRegistered.get(),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'vocoder-awp', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });

    const awpParams = this.awpHandle.parameters as Map<string, AudioParam>;
    this.carrierGain = new OverridableAudioParam(
      this.ctx,
      awpParams.get('carrier_gain')!,
      undefined,
      true
    );
    this.modulatorGain = new OverridableAudioParam(
      this.ctx,
      awpParams.get('modulator_gain')!,
      undefined,
      true
    );
    this.postGain = new OverridableAudioParam(
      this.ctx,
      awpParams.get('post_gain')!,
      undefined,
      true
    );
    this.handleStateChange(get(this.store));

    this.carrierInput.connect(this.awpHandle, 0, 0);
    this.modulatorInput.connect(this.awpHandle, 0, 1);

    const filterParams = this.buildAndEncoderFilterParams();
    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes, filterParams });

    if (this.vcId) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private deserialize(params: Record<string, any> | null | undefined): VocoderState {
    if (!params) {
      return buildDefaultVocoderState();
    }

    const defaults = buildDefaultVocoderState();
    return {
      carrierGainDb: params.carrierGainDb ?? defaults.carrierGainDb,
      modulatorGainDb: params.modulatorGainDb ?? defaults.modulatorGainDb,
      postGainDb: params.postGainDb ?? defaults.postGainDb,
    };
  }

  public serialize(): VocoderState {
    return R.clone(get(this.store));
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>()
        .set('carrier', {
          type: 'customAudio',
          node: this.carrierInput,
        })
        .set('modulator', {
          type: 'customAudio',
          node: this.modulatorInput,
        }),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        type: 'customAudio',
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
