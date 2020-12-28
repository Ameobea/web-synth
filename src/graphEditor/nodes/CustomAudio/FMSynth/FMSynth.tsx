import { Map as ImmMap } from 'immutable';
import { UnimplementedError, UnreachableException } from 'ameo-utils';

import FMSynthUI from 'src/fmSynth/FMSynthUI';
import { buildDefaultOperatorConfig, OperatorConfig } from 'src/fmSynth/ConfigureOperator';
import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { WavetableWasmBytes } from 'src/graphEditor/nodes/CustomAudio/WaveTable';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import {
  AudioConnectables,
  ConnectableInput,
  ConnectableOutput,
  updateConnectables,
} from 'src/patchNetwork';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { ParamSource } from 'src/fmSynth/ConfigureParamSource';

type FMSynthInputDescriptor =
  | { type: 'modulationValue'; srcOperatorIx: number; dstOperatorIx: number }
  | { type: 'outputWeight'; operatorIx: number };

const OPERATOR_COUNT = 8;
const VOICE_COUNT = 16;

const buildDefaultModulationIndices = (): number[][] => {
  const indices = new Array(OPERATOR_COUNT).fill(null);
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    indices[i] = new Array(OPERATOR_COUNT).fill(0);
  }
  return indices;
};

export default class FMSynth implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private generatedInputs: FMSynthInputDescriptor[] = [];
  private awpHandle: AudioWorkletNode | null = null;
  private modulationIndices: number[][] = buildDefaultModulationIndices();
  private outputWeights: number[] = new Array(OPERATOR_COUNT).fill(0);
  private operatorConfigs: OperatorConfig[] = new Array(OPERATOR_COUNT)
    .fill(undefined as any)
    .map(buildDefaultOperatorConfig);
  private onInitialized: ((connectables: AudioConnectables) => void) | undefined;

  static typeName = 'FM Synthesizer';
  public nodeType = 'customAudio/fmSynth';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  public getModulationIndices() {
    return this.modulationIndices;
  }
  public getOutputWeights() {
    return this.outputWeights;
  }
  public getOperatorConfigs() {
    return this.operatorConfigs;
  }

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    // TODO: Deserialize
    if (params) {
      this.deserialize(params);
    }

    this.init();

    this.renderSmallView = mkContainerRenderHelper({
      Comp: FMSynthUI,
      getProps: () => ({
        outputWeights: this.outputWeights,
        modulationIndices: this.modulationIndices,
        operatorConfigs: this.operatorConfigs,
        updateBackendModulation: (srcOperatorIx: number, dstOperatorIx: number, val: number) =>
          this.handleModulationIndexChange(srcOperatorIx, dstOperatorIx, val),
        onOperatorConfigChange: (operatorIx: number, newOperatorConfig: OperatorConfig) =>
          this.handleOperatorConfigChange(operatorIx, newOperatorConfig),
        updateBackendOutput: (operatorIx: number, val: number) =>
          this.handleOutputWeightChange(operatorIx, val),
      }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  private async init() {
    const [wasmBytes] = await Promise.all([
      WavetableWasmBytes.get(),
      this.ctx.audioWorklet.addModule('/FMSynthAWP.js'),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'fm-synth-audio-worklet-processor', {
      numberOfOutputs: VOICE_COUNT,
    });

    this.awpHandle.port.postMessage({
      type: 'setWasmBytes',
      wasmBytes,
      modulationIndices: this.modulationIndices,
      outputWeights: this.outputWeights,
    });

    this.awpHandle.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'wasmInitialized': {
          this.operatorConfigs.forEach((config, opIx) =>
            this.handleOperatorConfigChange(opIx, config)
          );
          if (this.onInitialized) {
            this.onInitialized(this.buildConnectables());
            this.onInitialized = undefined;
          }
          break;
        }
        default: {
          console.error('Unhandled event type from FM synth AWP: ', evt.data.type);
        }
      }
    };

    if (this.vcId) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private encodeParamSourceMessage(source: ParamSource) {
    switch (source.type) {
      case 'base frequency multiplier': {
        return { valueType: 3, valParamInt: 0, valParamFloat: source.multiplier };
      }
      case 'constant': {
        return { valueType: 1, valParamInt: 0, valParamFloat: source.value };
      }
      case 'param buffer': {
        return { valueType: 0, valParamInt: source['buffer index'], valParamFloat: 0 };
      }
      default: {
        throw new UnimplementedError(`frequency source not yet implemented: ${source.type}`);
      }
    }
  }

  private setOperatorBaseFrequencySource(operatorIx: number, source: ParamSource) {
    if (!this.awpHandle) {
      throw new UnreachableException();
    }

    this.awpHandle.port.postMessage({
      type: 'setOperatorBaseFrequencySource',
      operatorIx,
      ...this.encodeParamSourceMessage(source),
    });
  }

  public handleOperatorConfigChange(operatorIx: number, config: OperatorConfig) {
    this.operatorConfigs[operatorIx] = config;
    if (!this.awpHandle) {
      console.warn('Tried to update operator config before awp initialized');
      return;
    }

    // Set the operator config along with any hyperparam config
    this.awpHandle.port.postMessage({
      type: 'setOperatorConfig',
      operatorIx,
      operatorType: {
        wavetable: 0,
        'sine oscillator': 2,
        'exponential oscillator': 3,
        'param buffer': 1,
      }[config.type],
      ...(() => {
        switch (config.type) {
          case 'exponential oscillator': {
            return this.encodeParamSourceMessage(config.stretchFactor);
          }
          default: {
            return { valueType: 0, valParamInt: 0, valParamFloat: 0 };
          }
        }
      })(),
    });

    // Set base frequency source config for operators that support that
    switch (config.type) {
      case 'sine oscillator': {
        this.setOperatorBaseFrequencySource(operatorIx, config.frequency);
        break;
      }
      case 'exponential oscillator': {
        this.setOperatorBaseFrequencySource(operatorIx, config.frequency);
        break;
      }
    }
  }

  public handleOutputWeightChange(operatorIx: number, value: number) {
    if (!this.awpHandle) {
      console.error('Tried to update output weights before AWP initialization');
      return;
    }

    this.outputWeights[operatorIx] = value;

    this.awpHandle.port.postMessage({
      type: 'setOutputWeightValue',
      operatorIx,
      valueType: 1,
      valParamInt: 0,
      valParamFloat: value,
    });
  }

  public handleModulationIndexChange(srcOperatorIx: number, dstOperatorIx: number, val: number) {
    if (!this.awpHandle) {
      console.error('Tried to update modulation before AWP initialization');
      return;
    }

    this.modulationIndices[srcOperatorIx][dstOperatorIx] = val;

    this.awpHandle.port.postMessage({
      type: 'setModulationIndex',
      srcOperatorIx,
      dstOperatorIx,
      valueType: 1,
      valParamInt: 0,
      valParamFloat: val,
    });
  }

  private deserialize(params: { [key: string]: any }) {
    if (params.modulationIndices) {
      this.modulationIndices = params.modulationIndices;
    }
    if (params.outputWeights) {
      this.outputWeights = params.outputWeights;
    }
    if (params.operatorConfigs) {
      this.operatorConfigs = params.operatorConfigs;
    }
    if (params.onInitialized) {
      this.onInitialized = params.onInitialized;
    }
  }

  public serialize() {
    return {
      modulationIndices: this.modulationIndices,
      outputWeights: this.outputWeights,
      operatorConfigs: this.operatorConfigs,
    };
  }

  public setFrequency(voiceIx: number, frequency: number) {
    if (!this.awpHandle) {
      console.warn('Tried to set FM synth frequency before AWP initialized');
      return;
    }

    (this.awpHandle.parameters as Map<string, AudioParam>).get(
      `voice_${voiceIx}_base_frequency`
    )!.value = frequency;
  }

  public getAWPNode() {
    return this.awpHandle;
  }

  public buildConnectables() {
    return {
      // TODO: include all generated inputs
      inputs: ImmMap<string, ConnectableInput>()
        .set('frequency', {
          type: 'number',
          node: this.awpHandle
            ? (this.awpHandle.parameters as any).get('voice_14_base_frequency')
            : new DummyNode(),
        })
        .set('param_0', {
          type: 'number',
          node: this.awpHandle ? (this.awpHandle.parameters as any).get('0') : new DummyNode(),
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
