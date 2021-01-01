import React, { useState } from 'react';
import { Map as ImmMap } from 'immutable';
import ControlPanel from 'react-control-panel';
import * as R from 'ramda';

import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { AsyncOnce } from 'src/util';
import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { filterNils } from 'ameo-utils';

const NoiseGenAWPRegistered = new AsyncOnce(() =>
  new AudioContext().audioWorklet.addModule('/NoiseGenAWP.js')
);
const NoiseGenWasm = new AsyncOnce(() => fetch('/noise_gen.wasm').then(res => res.arrayBuffer()));

const NoiseGenSmallView: React.FC<{
  onChange: (key: string, val: number) => void;
  node: NoiseGenNode;
}> = ({ onChange, node }) => {
  const [enableSmoothing, setEnableSmoothing] = useState(node.enableSmoothing);
  const [enableUpdateFreq, setEnableUpdateFreq] = useState(node.noiseType === 3);

  return (
    <ControlPanel
      settings={filterNils([
        {
          type: 'select',
          label: 'noise_type',
          options: { 'Stepped Random': 3, 'White Noise': 0 },
          initial: node.noiseType,
        },
        enableUpdateFreq
          ? {
              type: 'range',
              label: 'update_interval_samples',
              min: 1,
              max: 100_000,
              step: 1,
              initial: node.updateFreqSamples,
            }
          : null,
        { type: 'checkbox', label: 'enable_smoothing', initial: node.enableSmoothing },
        enableSmoothing
          ? {
              type: 'range',
              label: 'smoothing_coefficient',
              min: 0.95,
              max: 0.9999,
              scale: 'log',
              initial: node.smoothingCoefficient,
            }
          : null,
        { type: 'range', label: 'gain', min: 0, max: 1, initial: node.gain },
      ])}
      onChange={(key: string, val: any) => {
        if (key === 'enable_smoothing') {
          setEnableSmoothing(val);
        } else if (key === 'noise_type') {
          setEnableUpdateFreq(+val === 3);
          onChange(key, +val);
          return;
        }

        onChange(key, val);
      }}
      style={{ width: 500 }}
    />
  );
};

export class NoiseGenNode {
  public vcId: string;
  public nodeType = 'customAudio/NoiseGenerator';
  static typeName = 'Noise & Random';
  public noiseType = 0;
  public updateFreqSamples = 10_000;
  public enableSmoothing = false;
  public smoothingCoefficient = 0.99;
  public gain = 1;

  private ctx: AudioContext;
  private awpNode: AudioWorkletNode | DummyNode = new DummyNode();

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

    this.maybeDeserialize(params);
    this.init();

    this.renderSmallView = mkContainerRenderHelper({
      Comp: NoiseGenSmallView,
      getProps: () => ({
        node: this,
        onChange: (key: string, val: any) => {
          if (this.awpNode instanceof DummyNode) {
            return;
          }

          switch (key) {
            case 'noise_type': {
              this.noiseType = val;
              this.awpNode.port.postMessage({
                type: 'setNoiseType',
                noiseType: val,
                updateFreqSamples: this.updateFreqSamples,
              });
              break;
            }
            case 'update_interval_samples': {
              this.updateFreqSamples = val;
              this.awpNode.port.postMessage({
                type: 'setNoiseType',
                noiseType: this.noiseType,
                updateFreqSamples: val,
              });
              break;
            }
            case 'enable_smoothing': {
              this.enableSmoothing = val;
              this.awpNode.port.postMessage({
                type: 'setSmoothingCoefficient',
                smoothingCoefficient: this.enableSmoothing ? this.smoothingCoefficient : 0,
              });
              break;
            }
            case 'smoothing_coefficient': {
              this.smoothingCoefficient = val;
              this.awpNode.port.postMessage({
                type: 'setSmoothingCoefficient',
                smoothingCoefficient: this.enableSmoothing ? this.smoothingCoefficient : 0,
              });
              break;
            }
            case 'gain': {
              this.gain = val;
              this.awpNode.port.postMessage({
                type: 'setGain',
                gain: val,
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
    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  private maybeDeserialize(params?: { [key: string]: any } | null) {
    if (!params) {
      return;
    }

    if (!R.isNil(params.noiseType)) {
      this.noiseType = params.noiseType;
    }
    if (!R.isNil(params.updateFreqSamples)) {
      this.updateFreqSamples = params.updateFreqSamples;
    }
    if (!R.isNil(params.enableSmoothing)) {
      this.enableSmoothing = params.enableSmoothing;
    }
    if (!R.isNil(params.smoothingCoefficient)) {
      this.smoothingCoefficient = params.smoothingCoefficient;
    }
    if (!R.isNil(params.gain)) {
      this.gain = params.gain;
    }
  }

  private async init() {
    const [sidechainWasm] = await Promise.all([
      NoiseGenWasm.get(),
      NoiseGenAWPRegistered.get(),
    ] as const);
    this.awpNode = new AudioWorkletNode(this.ctx, 'noise-generator-audio-worklet-node-processor');
    this.awpNode.port.postMessage({
      type: 'setWasmBytes',
      wasmBytes: sidechainWasm,
      noiseType: this.noiseType,
      updateFreqSamples: this.updateFreqSamples,
      smoothingCoefficient: this.enableSmoothing ? this.smoothingCoefficient : 0,
      gain: this.gain,
    });

    // Since we asynchronously init, we need to update our connections manually once we've created a valid internal state
    updateConnectables(this.vcId, this.buildConnectables());
  }

  public buildConnectables(): AudioConnectables & { node: NoiseGenNode } {
    return {
      vcId: this.vcId,
      inputs: ImmMap<string, ConnectableInput>(),
      outputs: ImmMap<string, ConnectableOutput>()
        .set('output_audio', {
          type: 'customAudio',
          node: this.awpNode,
        })
        .set('output_cv', {
          type: 'number',
          node: this.awpNode,
        }),
      node: this,
    };
  }

  public serialize(): { [key: string]: any } {
    return {
      noiseType: this.noiseType,
      updateFreqSamples: this.updateFreqSamples,
      enableSmoothing: this.enableSmoothing,
      smoothingCoefficient: this.smoothingCoefficient,
      gain: this.gain,
    };
  }
}
