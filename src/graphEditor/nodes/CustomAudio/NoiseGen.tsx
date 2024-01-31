import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import React, { useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { getSentry } from 'src/sentry';
import { AsyncOnce, filterNils } from 'src/util';

const NoiseGenAWPRegistered = new AsyncOnce(
  () =>
    new AudioContext().audioWorklet.addModule(
      process.env.ASSET_PATH +
        'NoiseGenAWP.js?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);
const NoiseGenWasm = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'noise_gen.wasm?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);

interface NoiseGenSmallViewProps {
  onChange: (key: string, val: number) => void;
  node: NoiseGenNode;
}

const NoiseGenSmallView: React.FC<NoiseGenSmallViewProps> = ({ onChange, node }) => {
  const [enableSmoothing, setEnableSmoothing] = useState(node.enableSmoothing);
  const [enableUpdateFreq, setEnableUpdateFreq] = useState(node.noiseType === 3);

  const settings = useMemo(
    () =>
      filterNils([
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
              max: 0.999999,
              initial: node.smoothingCoefficient,
              steps: 1000,
            }
          : null,
        !enableSmoothing
          ? {
              type: 'range',
              label: 'quantization_factor',
              min: 0,
              max: 150,
              step: 1,
              initial: node.quantizationFactor,
            }
          : null,
        { type: 'range', label: 'gain', min: 0, max: 1, initial: node.gain, steps: 1000 },
      ]),
    [
      enableSmoothing,
      enableUpdateFreq,
      node.enableSmoothing,
      node.gain,
      node.noiseType,
      node.quantizationFactor,
      node.smoothingCoefficient,
      node.updateFreqSamples,
    ]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <p style={{ marginLeft: 4 }}>
        <code>Outputs values in the range [-1, 1]</code>
      </p>
      <ControlPanel
        settings={settings}
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
        width={500}
      />
    </div>
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
  public quantizationFactor = 0;
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
    this.init().catch(err => {
      console.error('Error initializing NoiseGenNode', err);
      getSentry()?.captureException(err);
    });

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
                quantizationFactor: this.quantizationFactor,
              });
              break;
            }
            case 'smoothing_coefficient': {
              this.smoothingCoefficient = val;
              this.awpNode.port.postMessage({
                type: 'setSmoothingCoefficient',
                smoothingCoefficient: this.enableSmoothing ? this.smoothingCoefficient : 0,
                quantizationFactor: 0,
              });
              break;
            }
            case 'quantization_factor': {
              this.quantizationFactor = val;
              this.awpNode.port.postMessage({
                type: 'setQuantizationFactor',
                quantizationFactor: val,
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
    if (!R.isNil(params.quantizationFactor)) {
      this.quantizationFactor = params.quantizationFactor;
    }
  }

  private async init() {
    const [noiseGenWasm] = await Promise.all([
      NoiseGenWasm.get(),
      NoiseGenAWPRegistered.get(),
    ] as const);
    this.awpNode = new AudioWorkletNode(this.ctx, 'noise-generator-audio-worklet-node-processor', {
      numberOfOutputs: 1,
      numberOfInputs: 0,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });
    this.awpNode.port.postMessage({
      type: 'setWasmBytes',
      wasmBytes: noiseGenWasm,
      noiseType: this.noiseType,
      updateFreqSamples: this.updateFreqSamples,
      smoothingCoefficient: this.enableSmoothing ? this.smoothingCoefficient : 0,
      gain: this.gain,
      quantizationFactor: this.enableSmoothing ? 0 : this.quantizationFactor,
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
      quantizationFactor: this.quantizationFactor,
    };
  }
}
