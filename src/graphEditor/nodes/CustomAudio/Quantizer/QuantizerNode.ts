import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import { get, writable, type Writable } from 'svelte/store';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import {
  buildDefaultQuantizerNodeUIState,
  type QuantizerNodeUIState,
} from 'src/graphEditor/nodes/CustomAudio/Quantizer/types';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { getSentry } from 'src/sentry';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { AsyncOnce } from 'src/util';
import QuantizerNodeUI from './QuantizerNodeUI.svelte';

const QuantizerWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'quantizer.wasm?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);

const ctx = new AudioContext();
const QuantizerAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'QuantizerAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ),
  true
);

export default class QuantizerNode implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private awpHandle: AudioWorkletNode | null = null;
  private store: Writable<QuantizerNodeUIState> = writable(buildDefaultQuantizerNodeUIState());

  static typeName = 'Quantizer';
  public nodeType = 'customAudio/quantizer';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    if (params) {
      this.deserialize(params as QuantizerNodeUIState);
    }

    this.init().catch(err => {
      console.error('Error initializing QuantizerNode', err);
      getSentry()?.captureException(err);
    });

    this.store.subscribe(this.onChange);

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: QuantizerNodeUI,
      getProps: () => ({ store: this.store }),
    });

    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });
  }

  private async init() {
    const [wasmBytes] = await Promise.all([
      QuantizerWasmBytes.get(),
      QuantizerAWPRegistered.get(),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'quantizer', {
      channelCount: 1,
      numberOfInputs: 0,
      numberOfOutputs: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });

    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });
    this.onChange(get(this.store));

    if (this.vcId) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private onChange = (newState: QuantizerNodeUIState) =>
    this.awpHandle?.port.postMessage({
      type: 'setState',
      state: { quantizationInterval: newState.quantizationInterval.value, mode: newState.mode },
    });

  private deserialize(params: QuantizerNodeUIState) {
    this.store.set(params);
  }

  public serialize(): QuantizerNodeUIState {
    return R.clone(get(this.store));
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>().set('input', {
        type: 'number',
        node: this.awpHandle
          ? (this.awpHandle.parameters as Map<string, AudioParam>).get('input')!
          : new DummyNode(),
      }),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        type: 'number',
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
