import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import { get, writable, type Writable } from 'svelte/store';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { getSentry } from 'src/sentry';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { AsyncOnce, SAMPLE_RATE, samplesToMs } from 'src/util';
import CompressorSmallView from './CompressorSmallView.svelte';
import type { LGraphNode } from 'litegraph.js';

export interface CompressorBandState {
  gain: number;
  bottom_ratio: number;
  top_ratio: number;
  attack_ms: number;
  release_ms: number;
  bottom_threshold: number;
  top_threshold: number;
  mix: number;
}

export interface CompressorNodeUIState {
  preGain: number;
  detectionMode: 'rms' | 'peak';
  low: CompressorBandState;
  mid: CompressorBandState;
  high: CompressorBandState;
  postGain: number;
  bottomRatio: number;
  topRatio: number;
  knee: number;
  sab: Float32Array | null;
  bypass: boolean;
  mix: number;
  lowLatencyMode: boolean;
}

const DEFAULT_LOOKAHEAD_SAMPLES = SAMPLE_RATE / 10 / 3;

const buildDefaultCompressorBandState = (band: 'low' | 'mid' | 'high'): CompressorBandState => ({
  gain: 1,
  bottom_ratio: { low: 1, mid: 1, high: 1 }[band],
  top_ratio: { low: 444, mid: 66.7, high: 66.7 }[band],
  attack_ms: 3,
  release_ms: 250,
  bottom_threshold: { low: -40.8, mid: -41.8, high: -40.8 }[band],
  top_threshold: { low: -35.5, mid: -30.2, high: -33.8 }[band],
  mix: 1,
});

export const buildDefaultCompressorNodeUIState = (): CompressorNodeUIState => ({
  preGain: 1,
  detectionMode: 'peak',
  low: buildDefaultCompressorBandState('low'),
  mid: buildDefaultCompressorBandState('mid'),
  high: buildDefaultCompressorBandState('high'),
  postGain: 1,
  bottomRatio: 0.2,
  topRatio: 12,
  knee: 30,
  sab: null,
  bypass: false,
  mix: 1,
  lowLatencyMode: false,
});

const CompressorWasmBytes = new AsyncOnce(
  () => fetch(process.env.ASSET_PATH + 'compressor.wasm').then(res => res.arrayBuffer()),
  true
);
const ctx = new AudioContext();
const CompressorAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'CompressorAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);

export class CompressorNode implements ForeignNode {
  private dummyInput = new DummyNode('CompressorNodeInput');
  private dummyOutput = new DummyNode('CompressorNodeOutput');
  private ctx: AudioContext;
  private vcId: string;
  private awpHandle: AudioWorkletNode | null = null;
  private store: Writable<CompressorNodeUIState> = writable(buildDefaultCompressorNodeUIState());

  // params
  private mix: OverridableAudioParam | DummyNode = new DummyNode();
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
  private lowBandBottomThresholdDb: OverridableAudioParam | DummyNode = new DummyNode();
  private midBandBottomThresholdDb: OverridableAudioParam | DummyNode = new DummyNode();
  private highBandBottomThresholdDb: OverridableAudioParam | DummyNode = new DummyNode();
  private lowBandTopThresholdDb: OverridableAudioParam | DummyNode = new DummyNode();
  private midBandTopThresholdDb: OverridableAudioParam | DummyNode = new DummyNode();
  private highBandTopThresholdDb: OverridableAudioParam | DummyNode = new DummyNode();
  private lowBandBottomRatio: OverridableAudioParam | DummyNode = new DummyNode();
  private midBandBottomRatio: OverridableAudioParam | DummyNode = new DummyNode();
  private highBandBottomRatio: OverridableAudioParam | DummyNode = new DummyNode();
  private lowBandTopRatio: OverridableAudioParam | DummyNode = new DummyNode();
  private midBandTopRatio: OverridableAudioParam | DummyNode = new DummyNode();
  private highBandTopRatio: OverridableAudioParam | DummyNode = new DummyNode();
  private knee: OverridableAudioParam | DummyNode = new DummyNode();
  private lookaheadMs: OverridableAudioParam | DummyNode = new DummyNode();

  static typeName = 'Multi Compressor';
  public nodeType = 'customAudio/compressor';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  public onAddedToLG(lgNode: LGraphNode) {
    lgNode.setSize([165, 40]);
  }

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    if (!vcId) {
      throw new Error('vcId is required');
    }
    this.vcId = vcId;

    if (params) {
      this.deserialize(params as CompressorNodeUIState);
    }

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
      predicate: () => {
        try {
          unsubscribe?.();
        } catch (e) {
          console.warn('Error unsubscribing from compressor store', e);
        }
      },
    });

    this.init().catch(err => {
      console.error('Error initializing compressor node', err);
      getSentry()?.captureException(err);
    });
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
    this.awpHandle = new AudioWorkletNode(this.ctx, 'compressor-awp', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });
    this.awpHandle.port.onmessage = (e: MessageEvent) => this.handleMessageFromAWP(e);

    const params = this.awpHandle.parameters as Map<string, AudioParam>;
    this.mix = new OverridableAudioParam(ctx, params.get('mix')!, undefined, true);
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
    this.lowBandBottomThresholdDb = new OverridableAudioParam(
      ctx,
      params.get('low_band_bottom_threshold_db')!,
      undefined,
      true
    );
    this.midBandBottomThresholdDb = new OverridableAudioParam(
      ctx,
      params.get('mid_band_bottom_threshold_db')!,
      undefined,
      true
    );
    this.highBandBottomThresholdDb = new OverridableAudioParam(
      ctx,
      params.get('high_band_bottom_threshold_db')!,
      undefined,
      true
    );
    this.lowBandTopThresholdDb = new OverridableAudioParam(
      ctx,
      params.get('low_band_top_threshold_db')!,
      undefined,
      true
    );
    this.midBandTopThresholdDb = new OverridableAudioParam(
      ctx,
      params.get('mid_band_top_threshold_db')!,
      undefined,
      true
    );
    this.highBandTopThresholdDb = new OverridableAudioParam(
      ctx,
      params.get('high_band_top_threshold_db')!,
      undefined,
      true
    );
    this.lowBandBottomRatio = new OverridableAudioParam(
      ctx,
      params.get('low_band_bottom_ratio')!,
      undefined,
      true
    );
    this.midBandBottomRatio = new OverridableAudioParam(
      ctx,
      params.get('mid_band_bottom_ratio')!,
      undefined,
      true
    );
    this.highBandBottomRatio = new OverridableAudioParam(
      ctx,
      params.get('high_band_bottom_ratio')!,
      undefined,
      true
    );
    this.lowBandTopRatio = new OverridableAudioParam(
      ctx,
      params.get('low_band_top_ratio')!,
      undefined,
      true
    );
    this.midBandTopRatio = new OverridableAudioParam(
      ctx,
      params.get('mid_band_top_ratio')!,
      undefined,
      true
    );
    this.highBandTopRatio = new OverridableAudioParam(
      ctx,
      params.get('high_band_top_ratio')!,
      undefined,
      true
    );
    this.knee = new OverridableAudioParam(ctx, params.get('knee')!, undefined, true);
    this.lookaheadMs = new OverridableAudioParam(ctx, params.get('lookahead_ms')!, undefined, true);

    const state = get(this.store);
    this.awpHandle.port.postMessage({ type: 'setBypassed', bypass: state.bypass });
    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });
    this.onChange(state);
    updateConnectables(this.vcId, this.buildConnectables());
  }

  private onChange = (newState: CompressorNodeUIState) => {
    if (this.preGain instanceof DummyNode) {
      return;
    }

    this.awpHandle?.port.postMessage({ type: 'setBypassed', bypass: newState.bypass });
    (this.mix as OverridableAudioParam).manualControl.offset.value = newState.mix;
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
    (this.lowBandBottomThresholdDb as OverridableAudioParam).manualControl.offset.value =
      newState.low.bottom_threshold;
    (this.midBandBottomThresholdDb as OverridableAudioParam).manualControl.offset.value =
      newState.mid.bottom_threshold;
    (this.highBandBottomThresholdDb as OverridableAudioParam).manualControl.offset.value =
      newState.high.bottom_threshold;
    (this.lowBandTopThresholdDb as OverridableAudioParam).manualControl.offset.value =
      newState.low.top_threshold;
    (this.midBandTopThresholdDb as OverridableAudioParam).manualControl.offset.value =
      newState.mid.top_threshold;
    (this.highBandTopThresholdDb as OverridableAudioParam).manualControl.offset.value =
      newState.high.top_threshold;
    (this.lowBandBottomRatio as OverridableAudioParam).manualControl.offset.value =
      newState.low.bottom_ratio;
    (this.midBandBottomRatio as OverridableAudioParam).manualControl.offset.value =
      newState.mid.bottom_ratio;
    (this.highBandBottomRatio as OverridableAudioParam).manualControl.offset.value =
      newState.high.bottom_ratio;
    (this.lowBandTopRatio as OverridableAudioParam).manualControl.offset.value =
      newState.low.top_ratio;
    (this.midBandTopRatio as OverridableAudioParam).manualControl.offset.value =
      newState.mid.top_ratio;
    (this.highBandTopRatio as OverridableAudioParam).manualControl.offset.value =
      newState.high.top_ratio;
    (this.knee as OverridableAudioParam).manualControl.offset.value = newState.knee;
    (this.lookaheadMs as OverridableAudioParam).manualControl.offset.value = newState.lowLatencyMode
      ? samplesToMs(DEFAULT_LOOKAHEAD_SAMPLES / 2.5)
      : samplesToMs(DEFAULT_LOOKAHEAD_SAMPLES);
  };

  private deserialize(params: CompressorNodeUIState) {
    if (!params) {
      return;
    }

    this.store.set({
      ...params,
      high: {
        ...params.high,
        bottom_threshold: params.high.bottom_threshold ?? -34,
        top_threshold: params.high.top_threshold ?? -24,
        mix: params.high.mix ?? 1,
      },
      mid: {
        ...params.mid,
        bottom_threshold: params.mid.bottom_threshold ?? -34,
        top_threshold: params.mid.top_threshold ?? -24,
        mix: params.mid.mix ?? 1,
      },
      low: {
        ...params.low,
        bottom_threshold: params.low.bottom_threshold ?? -34,
        top_threshold: params.low.top_threshold ?? -24,
        mix: params.low.mix ?? 1,
      },
      bottomRatio: params.bottomRatio ?? 0.2,
      topRatio: params.topRatio ?? 12,
      knee: params.knee ?? 0,
      sab: null,
      mix: params.mix ?? 1,
      lowLatencyMode: params.lowLatencyMode ?? false,
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
