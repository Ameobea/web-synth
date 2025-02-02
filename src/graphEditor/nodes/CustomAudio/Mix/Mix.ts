import { Map as ImmMap } from 'immutable';

import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import MixSmallView from './MixSmallView.svelte';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { AsyncOnce } from 'src/util';
import { get, writable, type Writable } from 'svelte/store';

const ctx = new AudioContext();
const MixAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'MixAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);

interface MixState {
  mix: number;
  mode: 'customAudio' | 'number';
}

const buildDefaultMixState = (): MixState => ({ mix: 0.5, mode: 'customAudio' });

export class MixNode {
  private awpNode: AudioWorkletNode | DummyNode = new DummyNode();
  private dummyInputA: OverridableAudioParam | DummyNode = new DummyNode();
  private dummyInputB: OverridableAudioParam | DummyNode = new DummyNode();
  private mixOAP: OverridableAudioParam | DummyNode = new DummyNode();
  private vcId: string;
  private ctx: AudioContext;
  public state: Writable<MixState> = writable(buildDefaultMixState());

  public nodeType = 'customAudio/mix';
  static typeName = 'Mix';

  // unused but exists to match interface
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;
    this.mixOAP = new OverridableAudioParam(this.ctx);

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: MixSmallView,
      getProps: () => ({ node: this }),
    });
    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });

    if (params) {
      this.deserialize(params as MixState);
    }

    this.init();
  }

  private async init() {
    await MixAWPRegistered.get();
    this.awpNode = new AudioWorkletNode(this.ctx, 'mix-awp', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });

    const params = this.awpNode.parameters as Map<string, AudioParam>;
    this.mixOAP = new OverridableAudioParam(this.ctx, params.get('mix')!);
    this.dummyInputA = new OverridableAudioParam(this.ctx, params.get('inputA')!);
    this.dummyInputB = new OverridableAudioParam(this.ctx, params.get('inputB')!);
    const state = get(this.state);
    this.mixOAP.manualControl.offset.value = state.mix;

    updateConnectables(this.vcId, this.buildConnectables());
  }

  private deserialize(state: MixState) {
    this.state.set(state);
  }

  public buildConnectables(): AudioConnectables & { node: NonNullable<AudioConnectables['node']> } {
    const { mode } = get(this.state);
    return {
      inputs: ImmMap<string, ConnectableInput>()
        .set('input a', { type: mode, node: this.dummyInputA })
        .set('input b', { type: mode, node: this.dummyInputB })
        .set('mix', { type: 'number', node: this.mixOAP }),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        node: this.awpNode,
        type: mode,
      }),
      vcId: this.vcId,
      node: this,
    };
  }

  public setInputType(newInputType: 'audio' | 'cv') {
    this.state.update(state => ({
      ...state,
      mode: newInputType === 'audio' ? 'customAudio' : 'number',
    }));
    updateConnectables(this.vcId, this.buildConnectables());
  }

  public setMix(newMix: number) {
    this.state.update(state => ({ ...state, mix: newMix }));
    if (this.mixOAP instanceof OverridableAudioParam) {
      this.mixOAP.manualControl.offset.value = newMix;
    }
    updateConnectables(this.vcId, this.buildConnectables());
  }

  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];

  public serialize(): MixState {
    return { ...get(this.state) };
  }
}
