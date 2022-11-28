import { AsyncOnce } from 'ameo-utils';
import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import { get, writable, type Writable } from 'svelte/store';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import CompressorSmallView from './CompressorSmallView.svelte';

type Invalidator<T> = (value?: T) => void;

export interface CompressorBandState {
  gain: number;
  ratio: number;
  attack_ms: number;
  release_ms: number;
}

export interface CompressorNodeUIState {
  preGain: number;
  detectionMode: 'rms' | 'peak';
  low: CompressorBandState;
  mid: CompressorBandState;
  high: CompressorBandState;
  postGain: number;
  thresholdDb: number;
  ratio: number;
  knee: number;
  lookaheadMs: number;
  sab: Float32Array | null;
}

const buildDefaultCompressorBandState = (): CompressorBandState => ({
  gain: 1,
  ratio: 12,
  attack_ms: 3,
  release_ms: 250,
});

const buildDefaultCompressorNodeUIState = (): CompressorNodeUIState => ({
  preGain: 1,
  detectionMode: 'peak',
  low: buildDefaultCompressorBandState(),
  mid: buildDefaultCompressorBandState(),
  high: buildDefaultCompressorBandState(),
  postGain: 1,
  thresholdDb: -24,
  ratio: 12,
  knee: 30,
  lookaheadMs: 1.2,
  sab: null,
});

const CompressorWasmBytes = new AsyncOnce(() =>
  fetch(process.env.ASSET_PATH + 'compressor.wasm').then(res => res.arrayBuffer())
);
const ctx = new AudioContext();
const CompressorAWPRegistered = new AsyncOnce(() =>
  ctx.audioWorklet.addModule(
    process.env.ASSET_PATH +
      'CompressorAWP.js?cacheBust=' +
      (window.location.href.includes('localhost') ? '' : btoa(Math.random().toString()))
  )
);

export class CompressorNode implements ForeignNode {
  private dummyInput = new DummyNode();
  private dummyOutput = new DummyNode();
  private ctx: AudioContext;
  private vcId: string;
  private awpHandle: AudioWorkletNode | null = null;
  private store: Writable<CompressorNodeUIState> = writable(buildDefaultCompressorNodeUIState());

  // params
  private preGain: OverridableAudioParam | DummyNode = new DummyNode();
  private postGain: OverridableAudioParam | DummyNode = new DummyNode();
  private lowBandGain: OverridableAudioParam | DummyNode = new DummyNode();
  private midBandGain: OverridableAudioParam | DummyNode = new DummyNode();
  private highBandGain: OverridableAudioParam | DummyNode = new DummyNode();
  private lowBandAttackMs: OverridableAudioParam | DummyNode = new DummyNode();
  private midBandAttackMs: OverridableAudioParam | DummyNode = new DummyNode();
  private highBandAttackMs: OverridableAudioParam | DummyNode = new DummyNode();
  private lowBandReleaseMs: OverridableAudioParam | DummyNode = new DummyNode();
  private midBandReleaseMs: OverridableAudioParam | DummyNode = new DummyNode();
  private highBandReleaseMs: OverridableAudioParam | DummyNode = new DummyNode();
  private thresholdDb: OverridableAudioParam | DummyNode = new DummyNode();
  private ratio: OverridableAudioParam | DummyNode = new DummyNode();
  private knee: OverridableAudioParam | DummyNode = new DummyNode();
  private lookaheadMs: OverridableAudioParam | DummyNode = new DummyNode();

  static typeName = 'Compressor';
  public nodeType = 'customAudio/compressor';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    if (!vcId) {
      throw new Error('vcId is required');
    }
    this.vcId = vcId;

    if (params) {
      this.deserialize(params as CompressorNodeUIState);
    }
    this.onChange(get(this.store));

    let unsubscribe: (() => void) | undefined;

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: CompressorSmallView,
      getProps: () => ({ store: this.store }),
      predicate: () => {
        unsubscribe = this.store.subscribe(state => this.onChange(state));
      },
    });

    this.cleanupSmallView = mkSvelteContainerCleanupHelper({
      preserveRoot: true,
      predicate: () => unsubscribe?.(),
    });

    this.init();
  }

  private handleMessageFromAWP = (e: MessageEvent) => {
    const data = e.data as Record<string, any>;
    switch (data.type) {
      case 'sab': {
        const sab = data.sab as SharedArrayBuffer;
        this.store.update(s => ({ ...s, sab: new Float32Array(sab) }));
        break;
      }
      default:
        console.warn('Unknown message from AWP', data);
    }
  };

  private async init() {
    const [wasmBytes] = await Promise.all([
      CompressorWasmBytes.get(),
      CompressorAWPRegistered.get(),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'compressor-awp');
    this.awpHandle.port.onmessage = (e: MessageEvent) => this.handleMessageFromAWP(e);

    const params = this.awpHandle.parameters as Map<string, AudioParam>;
    this.preGain = new OverridableAudioParam(ctx, params.get('pre_gain')!, undefined, true);
    this.postGain = new OverridableAudioParam(ctx, params.get('post_gain')!, undefined, true);
    this.lowBandGain = new OverridableAudioParam(
      ctx,
      params.get('low_band_gain')!,
      undefined,
      true
    );
    this.midBandGain = new OverridableAudioParam(
      ctx,
      params.get('mid_band_gain')!,
      undefined,
      true
    );
    this.highBandGain = new OverridableAudioParam(
      ctx,
      params.get('high_band_gain')!,
      undefined,
      true
    );
    this.lowBandAttackMs = new OverridableAudioParam(
      ctx,
      params.get('low_band_attack_ms')!,
      undefined,
      true
    );
    this.midBandAttackMs = new OverridableAudioParam(
      ctx,
      params.get('mid_band_attack_ms')!,
      undefined,
      true
    );
    this.highBandAttackMs = new OverridableAudioParam(
      ctx,
      params.get('high_band_attack_ms')!,
      undefined,
      true
    );
    this.lowBandReleaseMs = new OverridableAudioParam(
      ctx,
      params.get('low_band_release_ms')!,
      undefined,
      true
    );
    this.midBandReleaseMs = new OverridableAudioParam(
      ctx,
      params.get('mid_band_release_ms')!,
      undefined,
      true
    );
    this.highBandReleaseMs = new OverridableAudioParam(
      ctx,
      params.get('high_band_release_ms')!,
      undefined,
      true
    );
    this.thresholdDb = new OverridableAudioParam(ctx, params.get('threshold_db')!, undefined, true);
    this.ratio = new OverridableAudioParam(ctx, params.get('ratio')!, undefined, true);
    this.knee = new OverridableAudioParam(ctx, params.get('knee')!, undefined, true);
    this.lookaheadMs = new OverridableAudioParam(ctx, params.get('lookahead_ms')!, undefined, true);

    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });
    this.onChange(get(this.store));
    updateConnectables(this.vcId, this.buildConnectables());
  }

  private onChange = (newState: CompressorNodeUIState) => {
    if (this.preGain instanceof DummyNode) {
      return;
    }

    (this.preGain as OverridableAudioParam).manualControl.offset.value = newState.preGain;
    (this.postGain as OverridableAudioParam).manualControl.offset.value = newState.postGain;
    (this.lowBandGain as OverridableAudioParam).manualControl.offset.value = newState.low.gain;
    (this.midBandGain as OverridableAudioParam).manualControl.offset.value = newState.mid.gain;
    (this.highBandGain as OverridableAudioParam).manualControl.offset.value = newState.high.gain;
    (this.lowBandAttackMs as OverridableAudioParam).manualControl.offset.value =
      newState.low.attack_ms;
    (this.midBandAttackMs as OverridableAudioParam).manualControl.offset.value =
      newState.mid.attack_ms;
    (this.highBandAttackMs as OverridableAudioParam).manualControl.offset.value =
      newState.high.attack_ms;
    (this.lowBandReleaseMs as OverridableAudioParam).manualControl.offset.value =
      newState.low.release_ms;
    (this.midBandReleaseMs as OverridableAudioParam).manualControl.offset.value =
      newState.mid.release_ms;
    (this.highBandReleaseMs as OverridableAudioParam).manualControl.offset.value =
      newState.high.release_ms;
    (this.thresholdDb as OverridableAudioParam).manualControl.offset.value = newState.thresholdDb;
    (this.ratio as OverridableAudioParam).manualControl.offset.value = newState.ratio;
    (this.knee as OverridableAudioParam).manualControl.offset.value = newState.knee;
    (this.lookaheadMs as OverridableAudioParam).manualControl.offset.value = newState.lookaheadMs;
  };

  private deserialize(params: CompressorNodeUIState) {
    if (!params) {
      return;
    }

    this.store.set({
      ...params,
      thresholdDb: params.thresholdDb ?? -24,
      ratio: params.ratio ?? 4,
      knee: params.knee ?? 0,
      lookaheadMs: params.lookaheadMs ?? 0,
      sab: null,
    });
  }

  public serialize(): CompressorNodeUIState {
    return R.clone({ ...get(this.store), sab: null });
  }

  public buildConnectables() {
    return {
      vcId: this.vcId,
      node: this,
      inputs: ImmMap<string, ConnectableInput>().set('input', {
        node: this.awpHandle ? this.awpHandle : this.dummyInput,
        type: 'customAudio',
      }),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        node: this.awpHandle ? this.awpHandle : this.dummyOutput,
        type: 'customAudio',
      }),
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
