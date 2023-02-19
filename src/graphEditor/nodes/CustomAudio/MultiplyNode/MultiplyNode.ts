import { Map as ImmMap } from 'immutable';
import { get, writable, type Unsubscriber, type Writable } from 'svelte/store';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import MultiplyNodeSmallView from 'src/graphEditor/nodes/CustomAudio/MultiplyNode/MultiplyNodeSmallView.svelte';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';

export interface MultiplyNodeState {
  input: number;
  times: number;
}

const buildDefaultMultiplyNodeState = (): MultiplyNodeState => ({
  input: 0,
  times: 1,
});

export class MultiplyNode implements ForeignNode {
  private vcId: string | undefined;
  private csn: ConstantSourceNode;
  private gain: GainNode;
  private input: OverridableAudioParam;
  private times: OverridableAudioParam;
  private state: Writable<MultiplyNodeState>;

  static typeName = 'Multiply';
  public nodeType = 'customAudio/multiply';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.csn = new ConstantSourceNode(ctx);
    this.csn.offset.value = 0;
    this.csn.start();
    this.gain = new GainNode(ctx);
    this.gain.gain.value = 0;
    this.csn.connect(this.gain);

    this.input = new OverridableAudioParam(ctx, this.csn.offset, undefined, true);
    this.times = new OverridableAudioParam(ctx, this.gain.gain, undefined, true);

    this.state = writable(this.deserialize(params));
    this.input.manualControl.offset.value = get(this.state).input;
    this.times.manualControl.offset.value = get(this.state).times;

    let unsubscribe: Unsubscriber | undefined;
    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: MultiplyNodeSmallView,
      predicate: () => {
        unsubscribe = this.state.subscribe(newState => this.handleStateChange(newState));
      },
      getProps: () => ({ store: this.state }),
    });
    this.cleanupSmallView = mkSvelteContainerCleanupHelper({
      predicate: () => unsubscribe?.(),
      preserveRoot: true,
    });
  }

  private handleStateChange(newState: MultiplyNodeState) {
    this.input.manualControl.offset.value = newState.input;
    this.times.manualControl.offset.value = newState.times;
  }

  public serialize(): MultiplyNodeState {
    return get(this.state);
  }

  public deserialize(params: Record<string, any> | null | undefined): MultiplyNodeState {
    const defaultState = buildDefaultMultiplyNodeState();
    if (!params) {
      return defaultState;
    }

    return {
      input: params.input ?? defaultState.input,
      times: params.times ?? defaultState.times,
    };
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>()
        .set('input', {
          type: 'number',
          node: this.gain,
        })
        .set('times', {
          type: 'number',
          node: this.times,
        }),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        type: 'number',
        node: this.gain,
      }),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
