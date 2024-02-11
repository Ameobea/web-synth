import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import { get, writable, type Writable } from 'svelte/store';

import { encodeEffect, type Effect } from 'src/fmSynth/Effect';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { WavetableWasmBytes } from 'src/graphEditor/nodes/CustomAudio/WaveTable/WavetableWasm';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { getSentry } from 'src/sentry';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { AsyncOnce } from 'src/util';
import FMSynthFxSmallView from './FMSynthFxSmallView.svelte';

export interface FMSynthFxState {
  effects: (Effect | null)[];
}

const FM_SYNTH_FX_NODE_PARAM_COUNT = 4 as const;

const buildDefaultFMSynthFxState = (): FMSynthFxState => ({
  effects: new Array(FM_SYNTH_FX_NODE_PARAM_COUNT).fill(null),
});

const ctx = new AudioContext();
const FMSynthFxAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'FMSynthFxAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ),
  true
);

export class FMSynthFxNode implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string;
  private awpHandle: AudioWorkletNode | null = null;
  private store: Writable<FMSynthFxState>;
  private dummyInput: DummyNode = new DummyNode();
  private dummyParams: [DummyNode, DummyNode, DummyNode, DummyNode] = [
    new DummyNode(),
    new DummyNode(),
    new DummyNode(),
    new DummyNode(),
  ];

  static typeName = 'FM Synth FX';
  public nodeType = 'customAudio/fmSynthFx';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    this.store = writable(this.deserialize(params));

    this.init().catch(err => {
      console.error('Error initializing FMSynthFxNode', err);
      getSentry()?.captureException(err);
    });

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: FMSynthFxSmallView,
      getProps: () => ({
        store: this.store,
        onChange: (ix: number, newState: Partial<Effect> | null) => this.handleChange(ix, newState),
        commitAll: () => {
          const state = get(this.store);
          state.effects.forEach((effect, effectIx) => this.commitEffect(effectIx, effect));
        },
      }),
    });

    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });
  }

  private async init() {
    const [wasmBytes] = await Promise.all([
      WavetableWasmBytes.get(),
      FMSynthFxAWPRegistered.get(),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'fm-synth-fx-awp', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });
    updateConnectables(this.vcId, this.buildConnectables());

    this.awpHandle.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'wasmInitialized':
          const state = get(this.store);
          state.effects.forEach((effect, effectIx) => this.commitEffect(effectIx, effect));
          // TODO: Handle ADSR SAB when implemented
          break;
        default:
          console.error('Unknown message from FMSynthFxAWP', evt.data);
      }
    };

    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });

    if (this.vcId) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private commitEffect(effectIx: number, newEffect: Effect | null) {
    if (!this.awpHandle) {
      return;
    }

    const encodedEffect = encodeEffect(newEffect);
    this.awpHandle.port.postMessage({
      type: 'setEffect',
      effectIx,
      encodedEffect,
      isBypassed: newEffect?.isBypassed ?? false,
    });
  }

  private handleChange = (effectIx: number, effectUpdate: Partial<Effect> | null) =>
    this.store.update(state => {
      const oldEffect = state.effects[effectIx] ?? {};
      const newEffect: Effect | null = effectUpdate
        ? { ...oldEffect, ...(effectUpdate as any) }
        : effectUpdate;

      this.commitEffect(effectIx, newEffect);
      const newState = { ...state };
      newState.effects = [...state.effects];
      newState.effects[effectIx] = newEffect;

      if (!newEffect) {
        // Slide remaining effects down.  Deleting will trigger this to happen on the backend as well.
        for (let i = effectIx; i < newState.effects.length; i++) {
          const nextEffect = newState.effects[i + 1];
          if (nextEffect) {
            newState.effects[i] = nextEffect;
            newState.effects[i + 1] = null;
            this.commitEffect(i + 1, null);
          }
        }
      }

      return newState;
    });

  private deserialize(params: Record<string, any> | null | undefined): FMSynthFxState {
    const defaultState = buildDefaultFMSynthFxState();
    if (!params) {
      return defaultState;
    }

    const effects = params.effects ?? defaultState.effects;
    while (effects.length < FM_SYNTH_FX_NODE_PARAM_COUNT) {
      effects.push(null);
    }

    return { effects };
  }

  public serialize(): FMSynthFxState {
    return R.clone(get(this.store));
  }

  public buildConnectables() {
    let inputs = ImmMap<string, ConnectableInput>().set('input', {
      node: this.awpHandle ?? this.dummyInput,
      type: 'customAudio',
    });
    const awpParams = this.awpHandle?.parameters as Map<string, AudioParam> | undefined;
    for (let paramIx = 0; paramIx < FM_SYNTH_FX_NODE_PARAM_COUNT; paramIx++) {
      inputs = inputs.set(`param_${paramIx}`, {
        node: awpParams?.get(`${paramIx}`) ?? this.dummyParams[paramIx],
        type: 'number',
      });
    }

    return {
      inputs,
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
