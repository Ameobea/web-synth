import { get, writable, type Writable } from 'svelte/store';
import { Map as ImmMap } from 'immutable';

import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import DetuneSmallView from './DetuneSmallView.svelte';
import { AsyncOnce } from 'src/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';

const ctx = new AudioContext();
const DetuneAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'DetuneAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);

interface DetuneState {
  detuneCents: number;
}

const buildDefaultDetuneState = (): DetuneState => ({
  detuneCents: 0,
});

export class DetuneNode {
  private awpNode: AudioWorkletNode | DummyNode = new DummyNode();
  private vcId: string;
  private ctx: AudioContext;
  private detuneParam: OverridableAudioParam | DummyNode = new DummyNode();
  public state: Writable<DetuneState> = writable(buildDefaultDetuneState());

  public nodeType = 'customAudio/detune';
  static typeName = 'Detune';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: DetuneSmallView,
      getProps: () => ({ node: this }),
    });
    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });

    if (params) {
      this.deserialize(params as DetuneState);
    }

    this.init();
  }

  private async init() {
    await DetuneAWPRegistered.get();
    this.awpNode = new AudioWorkletNode(this.ctx, 'detune-awp', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });

    this.detuneParam = new OverridableAudioParam(
      this.ctx,
      (this.awpNode.parameters as Map<string, AudioParam>).get('detune_cents')
    );

    updateConnectables(this.vcId, this.buildConnectables());
  }

  public setDetuneCents(detuneCents: number) {
    this.state.update(state => ({ ...state, detuneCents }));
    if (this.detuneParam instanceof OverridableAudioParam) {
      this.detuneParam.manualControl.offset.value = detuneCents;
    }
  }

  private deserialize(state: DetuneState) {
    this.state.set(state);
  }

  public buildConnectables(): AudioConnectables & { node: NonNullable<AudioConnectables['node']> } {
    return {
      inputs: ImmMap<string, ConnectableInput>()
        .set('frequency', { type: 'number', node: this.awpNode })
        .set('detune', { type: 'number', node: this.detuneParam }),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        type: 'number',
        node: this.awpNode,
      }),
      vcId: this.vcId,
      node: this,
    };
  }

  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];

  public serialize(): DetuneState {
    return { ...get(this.state) };
  }
}
