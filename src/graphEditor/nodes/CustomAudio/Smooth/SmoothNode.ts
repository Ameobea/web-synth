import { get, writable, type Writable } from 'svelte/store';
import { Map as ImmMap } from 'immutable';

import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import SmoothSmallView from './SmoothSmallView.svelte';
import { AsyncOnce } from 'src/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';

const ctx = new AudioContext();
const SmoothAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'SmoothAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);

interface SmoothState {
  filterCoefficient: number;
}

const buildDefaultSmoothState = (): SmoothState => ({ filterCoefficient: 0.99 });

export class SmoothNode {
  private awpNode: AudioWorkletNode | DummyNode = new DummyNode();
  private vcId: string;
  private ctx: AudioContext;
  public state: Writable<SmoothState> = writable(buildDefaultSmoothState());

  public nodeType = 'customAudio/smooth';
  static typeName = 'Smooth';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: SmoothSmallView,
      getProps: () => ({ node: this }),
    });
    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });

    if (params) {
      this.deserialize(params as SmoothState);
    }

    this.init();
  }

  private async init() {
    await SmoothAWPRegistered.get();
    this.awpNode = new AudioWorkletNode(this.ctx, 'smooth-awp', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });

    this.awpNode.port.postMessage({ type: 'setState', state: get(this.state) });
    this.awpNode.port.onmessage = e => {
      switch (e.data.type) {
        case 'initialized': {
          updateConnectables(this.vcId, this.buildConnectables());
          break;
        }
        default: {
          console.error('Unknown message from SmoothAWP', e);
        }
      }
    };
  }

  public setFilterCoefficient(filterCoefficient: number) {
    this.state.update(state => ({ ...state, filterCoefficient }));
    if (this.awpNode instanceof AudioWorkletNode) {
      this.awpNode.port.postMessage({ type: 'setState', state: get(this.state) });
    }
  }

  private deserialize(state: SmoothState) {
    this.state.set(state);
  }

  public buildConnectables(): AudioConnectables & { node: NonNullable<AudioConnectables['node']> } {
    return {
      inputs: ImmMap<string, ConnectableInput>().set('input', {
        type: 'number',
        node: this.awpNode,
      }),
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

  public serialize(): SmoothState {
    return { ...get(this.state) };
  }
}
