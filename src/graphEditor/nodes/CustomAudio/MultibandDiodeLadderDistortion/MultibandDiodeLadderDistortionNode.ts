import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import { get, writable, type Writable } from 'svelte/store';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import MBDLDNodeSmallView from 'src/graphEditor/nodes/CustomAudio/MultibandDiodeLadderDistortion/MBDLDNodeSmallView.svelte';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { getSentry } from 'src/sentry';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { AsyncOnce } from 'src/util';

const MBDLDRustWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'multiband_diode_ladder_distortion.wasm?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);
const MBDLDFaustWasmBytes = new AsyncOnce(
  () =>
    fetch(
      'https://storage.googleapis.com/web_synth-compiled_faust_modules_wasm/259e57a4d36f40e1ab33c67da41c1acf8e22d2f4_optimized.wasm'
    ).then(res => res.arrayBuffer()),
  true
);

const ctx = new AudioContext();
const MBDLDAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'MultibandDiodeLadderDistortionAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ),
  true
);

export interface MBDLDNodeBandState {
  preGain: number;
  postGain: number;
  Q: number;
  normalizedFrequency: number;
  wet: number;
  dry: number;
}

export interface MBDLDNodeState {
  low: MBDLDNodeBandState;
  mid: MBDLDNodeBandState;
  high: MBDLDNodeBandState;
}

const buildDefaultMBDLDNodeState = (): MBDLDNodeState => ({
  low: {
    Q: 1.194,
    normalizedFrequency: 1,
    wet: 0.053,
    dry: 1 - 0.053,
    preGain: 1,
    postGain: 1,
  },
  mid: {
    Q: 9.27,
    normalizedFrequency: 1,
    wet: 0.17,
    dry: 1 - 0.17,
    preGain: 1,
    postGain: 1,
  },
  high: {
    Q: 11.144,
    normalizedFrequency: 0.96,
    wet: 0.148,
    dry: 1 - 0.148,
    preGain: 1,
    postGain: 1,
  },
});

export class MBDLDNode implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private awpHandle: AudioWorkletNode | null = null;
  private store: Writable<MBDLDNodeState>;

  static typeName = 'Multiband Diode Ladder Distortion';
  public nodeType = 'customAudio/multibandDiodeLadderDistortion';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: Record<string, any> | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    this.store = writable(this.deserialize(params));

    this.init().catch(err => {
      console.error('Error initializing MBDLDNode', err);
      getSentry()?.captureException(err);
    });

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: MBDLDNodeSmallView,
      getProps: () => ({ store: this.store, onChange: this.handleChange }),
    });

    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });
  }

  private handleChange = (
    band: 'low' | 'mid' | 'high',
    key: keyof MBDLDNodeBandState,
    val: number
  ) => {
    this.store.update(state => ({ ...state, [band]: { ...state[band], [key]: val } }));
    this.awpHandle?.port.postMessage({ type: 'setParam', band, param: key, value: val });
  };

  private async init() {
    console.log('Initializing MBDLDNode');
    const [faustWasmBytes, rustWasmBytes] = await Promise.all([
      MBDLDFaustWasmBytes.get(),
      MBDLDRustWasmBytes.get(),
      MBDLDAWPRegistered.get(),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'multiband-diode-ladder-distortion-awp', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });

    const initialParams: MBDLDNodeState = get(this.store);
    this.awpHandle.port.postMessage({
      type: 'setWasmBytes',
      faustWasmBytes,
      rustWasmBytes,
      initialParams,
    });

    if (this.vcId) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private deserialize(params: Record<string, any> | null | undefined): MBDLDNodeState {
    if (!params) {
      return buildDefaultMBDLDNodeState();
    }

    const defaults = buildDefaultMBDLDNodeState();
    return {
      ...defaults,
      low: { ...defaults.low, ...(params.low ?? {}) },
      mid: { ...defaults.mid, ...(params.mid ?? {}) },
      high: { ...defaults.high, ...(params.high ?? {}) },
    };
  }

  public serialize(): MBDLDNodeState {
    return R.clone(get(this.store));
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>().set('input', {
        type: 'customAudio',
        node: this.awpHandle ? this.awpHandle : new DummyNode(),
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
