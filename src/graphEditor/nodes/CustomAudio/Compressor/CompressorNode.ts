import { AsyncOnce } from 'ameo-utils';
import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import { get, writable, type Writable } from 'svelte/store';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import CompressorSmallView from './CompressorSmallView.svelte';

interface CompressorNodeUIState {}

const buildDefaultCompressorNodeUIState = (): CompressorNodeUIState => ({});

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

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: CompressorSmallView,
      getProps: () => ({ store: this.store }),
    });

    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });

    this.init();
  }

  private async init() {
    const [wasmBytes] = await Promise.all([
      CompressorWasmBytes.get(),
      CompressorAWPRegistered.get(),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'midi-quantizer');

    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });
    this.onChange(get(this.store));
    updateConnectables(this.vcId, this.buildConnectables());
  }

  private onChange = (newState: CompressorNodeUIState) => {
    // TODO
  };

  private deserialize(params: CompressorNodeUIState) {
    if (!params) {
      return;
    }

    this.store.set(params);
  }

  public serialize(): CompressorNodeUIState {
    return R.clone(get(this.store));
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
