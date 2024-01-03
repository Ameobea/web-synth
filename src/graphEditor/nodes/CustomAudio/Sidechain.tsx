import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { getSentry } from 'src/sentry';
import { AsyncOnce } from 'src/util';

const SidechainAWPRegistered = new AsyncOnce(
  () =>
    new AudioContext().audioWorklet.addModule(
      process.env.ASSET_PATH +
        'SidechainWorkletProcessor.js?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : genRandomStringID())
    ),
  true
);
const SidechainWasm = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'sidechain.wasm' +
        (window.location.host.includes('localhost') ? '' : `?${genRandomStringID()}`)
    ).then(res => res.arrayBuffer()),
  true
);

interface SidechainState {
  window_size_samples: number;
  lowpass_coefficient: number;
  range_multiplier: number;
  bypass: boolean;
}

const buildDefaultSidechainState = (): SidechainState => ({
  window_size_samples: 800,
  lowpass_coefficient: 0.5,
  range_multiplier: -1,
  bypass: false,
});

interface SidechainSmallViewProps {
  onChange: (key: string, val: number) => void;
  initialState: SidechainState;
}

const SidechainSmallView: React.FC<SidechainSmallViewProps> = ({ onChange, initialState }) => {
  const settings = useMemo(
    () => [
      { type: 'checkbox', label: 'bypass', initial: initialState.bypass },
      {
        type: 'range',
        label: 'window_size_samples',
        min: 1,
        max: 2400,
        step: 1,
        initial: initialState.window_size_samples,
      },
      {
        type: 'range',
        label: 'lowpass_coefficient',
        min: 0.5,
        max: 0.999,
        initial: initialState.lowpass_coefficient,
      },
      {
        type: 'range',
        label: 'range_multiplier',
        min: -3,
        max: 3,
        step: 0.001,
        initial: initialState.range_multiplier,
      },
    ],
    [
      initialState.bypass,
      initialState.lowpass_coefficient,
      initialState.range_multiplier,
      initialState.window_size_samples,
    ]
  );

  return <ControlPanel settings={settings} onChange={onChange} style={{ width: 500 }} />;
};

export class Sidechain {
  public vcId: string;
  public nodeType = 'customAudio/Sidechain';
  static typeName = 'Sidechain';

  private ctx: AudioContext;
  private gainNode: GainNode;
  private gainDebugNode: GainNode;
  private awpNode: AudioWorkletNode | null = null;
  private state: SidechainState = buildDefaultSidechainState();

  /**
   * See the docs for `enhanceAudioNode`.
   */
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.ctx = ctx;
    this.gainNode = new GainNode(this.ctx);
    this.gainNode.gain.value = 1;
    this.gainDebugNode = new GainNode(this.ctx);
    this.gainDebugNode.gain.value = 1;

    if (params) {
      this.deserialize(params);
    }

    this.init().catch(err => {
      console.error('Error initializing sidechain node: ', err);
      getSentry()?.captureException(err);
    });

    this.renderSmallView = mkContainerRenderHelper({
      Comp: SidechainSmallView,
      getProps: () => ({
        onChange: (key: string, val: number) => this.onChange(key as keyof SidechainState, val),
        initialState: R.clone(this.state),
      }),
    });
    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  private onChange(key: keyof SidechainState, val: any) {
    if (!(key in this.state)) {
      console.error(`Invalid key ${key} passed to \`Sidechain.onChange\``);
      return;
    }

    (this.state as any)[key] = val;

    if (!this.awpNode) {
      return;
    }

    switch (key) {
      case 'window_size_samples': {
        this.awpNode.port.postMessage({
          type: 'setWindowSizeSamples',
          windowSizeSamples: val,
        });
        break;
      }
      case 'lowpass_coefficient': {
        this.awpNode.port.postMessage({
          type: 'setLowpassCoefficient',
          lowpassCoefficient: val,
        });
        break;
      }
      case 'range_multiplier': {
        this.awpNode.port.postMessage({
          type: 'setRangeMultiplier',
          rangeMultiplier: val,
        });
        break;
      }
      case 'bypass': {
        this.awpNode.port.postMessage({
          type: 'setBypass',
          bypass: val,
        });
        break;
      }
      default: {
        console.warn('Unhandled key in sidechain UI onchange: ', key);
      }
    }
  }

  private async init() {
    const [sidechainWasm] = await Promise.all([
      SidechainWasm.get(),
      SidechainAWPRegistered.get(),
    ] as const);

    this.awpNode = new AudioWorkletNode(this.ctx, 'sidechain-audio-worklet-node-processor', {
      // TODO: breaks when this is set
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
      numberOfOutputs: 1,
      channelCount: 1,
    });
    this.awpNode.port.onmessage = e => {
      switch (e.data.type) {
        case 'wasmInitialized': {
          for (const key of Object.keys(this.state) as (keyof SidechainState)[]) {
            this.onChange(key, this.state[key]);
          }
          break;
        }
        default: {
          console.warn('Unhandled message from sidechain AWP: ', e.data);
        }
      }
    };

    this.awpNode.port.postMessage({ type: 'setWasmBytes', wasmBytes: sidechainWasm });

    // The output of the node gets sent into the gain node
    this.awpNode.connect(this.gainNode.gain, 0);
    this.awpNode.connect(this.gainDebugNode, 0);

    // Since we asynchronously init, we need to update our connections manually once we've created a valid internal state
    updateConnectables(this.vcId, this.buildConnectables());
  }

  public buildConnectables(): AudioConnectables & { node: Sidechain } {
    return {
      vcId: this.vcId,
      inputs: ImmMap<string, ConnectableInput>()
        .set('input', { type: 'customAudio', node: this.gainNode })
        .set('control', {
          type: 'customAudio',
          node: this.awpNode ? this.awpNode : new DummyNode(),
        }),
      outputs: ImmMap<string, ConnectableOutput>()
        .set('output', {
          type: 'customAudio',
          node: this.gainNode,
        })
        .set('gain_debug', { type: 'number', node: this.gainDebugNode }),
      node: this,
    };
  }

  public serialize(): { [key: string]: any } {
    return { ...this.state };
  }

  public deserialize(data: { [key: string]: any }) {
    this.state = { ...this.state, ...data };
  }
}
