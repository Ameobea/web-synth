import { get, writable, type Writable } from 'svelte/store';
import { Map as ImmMap } from 'immutable';

import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import TimeConverterSmallView from './TimeConverterSmallView.svelte';
import { AsyncOnce } from 'src/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';

const ctx = new AudioContext();
const TimeConverterAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'TimeConverterAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);

interface TimeConverterState {
  fromUnit: string;
  toUnit: string;
}

const buildDefaultTimeConverterState = (): TimeConverterState => ({
  fromUnit: 'beats',
  toUnit: 'milliseconds',
});

export class TimeConverterNode {
  private awpNode: AudioWorkletNode | DummyNode = new DummyNode();
  private vcId: string;
  private ctx: AudioContext;
  public state: Writable<TimeConverterState> = writable(buildDefaultTimeConverterState());

  public nodeType = 'customAudio/timeConverter';
  static typeName = 'Time Converter';

  // unused but exists to match interface
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: TimeConverterSmallView,
      getProps: () => ({ node: this }),
    });
    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });

    if (params) {
      this.deserialize(params as TimeConverterState);
    }

    this.init();
  }

  private async init() {
    await TimeConverterAWPRegistered.get();
    this.awpNode = new AudioWorkletNode(this.ctx, 'time-converter-awp', {
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
          console.error('Unknown message from TimeConverterAWP', e);
        }
      }
    };
  }

  public setFromUnit(fromUnit: string) {
    this.state.update(state => ({ ...state, fromUnit }));
    if (this.awpNode instanceof AudioWorkletNode) {
      this.awpNode.port.postMessage({ type: 'setState', state: get(this.state) });
    }
  }

  public setToUnit(toUnit: string) {
    this.state.update(state => ({ ...state, toUnit }));
    if (this.awpNode instanceof AudioWorkletNode) {
      this.awpNode.port.postMessage({ type: 'setState', state: get(this.state) });
    }
  }

  private deserialize(state: TimeConverterState) {
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

  public serialize(): TimeConverterState {
    return { ...get(this.state) };
  }
}
