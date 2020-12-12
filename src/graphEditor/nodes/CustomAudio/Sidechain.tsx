import React from 'react';
import { Map as ImmMap } from 'immutable';
import ControlPanel from 'react-control-panel';

import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import {
  AudioConnectables,
  ConnectableInput,
  ConnectableOutput,
  updateConnectables,
} from 'src/patchNetwork';
import { mkContainerRenderHelper } from 'src/reactUtils';
import { AsyncOnce } from 'src/util';
import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';

const SidechainAWPRegistered = new AsyncOnce(() =>
  new AudioContext().audioWorklet.addModule('/SidechainWorkletProcessor.js')
);
const SidechainWasm = new AsyncOnce(() => fetch('/sidechain.wasm').then(res => res.arrayBuffer()));

const SidechainSmallView: React.FC<{
  onChange: (key: string, val: number) => void;
}> = ({ onChange }) => (
  <ControlPanel
    settings={[
      { type: 'range', label: 'window_size_samples', min: 1, max: 2400, step: 1, initial: 64 },
      { type: 'range', label: 'lowpass_coefficient', min: 0.5, max: 0.999, initial: 9.99 },
      { type: 'range', label: 'range_multiplier', min: -1, max: 1, step: 0.001, initial: -0.3 },
    ]}
    onChange={onChange}
    style={{ width: 500 }}
  />
);

export class Sidechain {
  public vcId: string;
  public nodeType = 'customAudio/Sidechain';
  public name = 'Sidechain';

  private ctx: AudioContext;
  private gainNode: GainNode;
  private gainDebugNode: GainNode;
  private awpNode: AudioWorkletNode | null = null;

  /**
   * See the docs for `enhanceAudioNode`.
   */
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];

  constructor(ctx: AudioContext, vcId: string, _params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.ctx = ctx;
    this.gainNode = new GainNode(this.ctx);
    this.gainNode.gain.value = 1;
    this.gainDebugNode = new GainNode(this.ctx);
    this.gainDebugNode.gain.value = 1;

    this.init();

    this.renderSmallView = mkContainerRenderHelper({
      Comp: SidechainSmallView,
      getProps: () => ({
        onChange: (key: string, val: number) => {
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
            default: {
              console.warn('Unhandled key in sidechain UI onchange: ', key);
            }
          }
        },
        initialState: {
          // TODO: Deserialize
        },
      }),
    });
  }

  private async init() {
    const [sidechainWasm] = await Promise.all([
      SidechainWasm.get(),
      SidechainAWPRegistered.get(),
    ] as const);
    this.awpNode = new AudioWorkletNode(this.ctx, 'sidechain-audio-worklet-node-processor');
    this.awpNode.port.postMessage({ type: 'setWasmBytes', wasmBytes: sidechainWasm });

    // The output of the node gets sent into the gain node
    this.awpNode.connect(this.gainNode.gain);
    this.awpNode.connect(this.gainDebugNode);

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
    return {}; // TODO
  }
}
