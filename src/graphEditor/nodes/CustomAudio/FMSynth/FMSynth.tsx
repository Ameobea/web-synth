import { Map as ImmMap } from 'immutable';
import { UnimplementedError, UnreachableException } from 'ameo-utils';

import { ConnectedFMSynthUI } from 'src/fmSynth/FMSynthUI';
import { buildDefaultOperatorConfig, OperatorConfig } from 'src/fmSynth/ConfigureOperator';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import type { ParamSource } from 'src/fmSynth/ConfigureParamSource';
import type { Effect } from 'src/fmSynth/ConfigureEffects';
import { AsyncOnce } from 'src/util';

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

const WavetableWasmBytes = new AsyncOnce(() =>
  fetch('/wavetable.wasm').then(res => res.arrayBuffer())
);

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
  private operatorEffects: (Effect | null)[][] = new Array(OPERATOR_COUNT)
    .fill(null as any)
    .map(() => new Array(16).fill(null));
  private mainEffectChain: (Effect | null)[] = new Array(16).fill(null);
  public selectedOperatorIx: number | null = null;
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
  public getOperatorEffects() {
    return this.operatorEffects;
  }
  public getMainEffectChain() {
    return this.mainEffectChain;
  }

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    if (params) {
      this.deserialize(params);
    }

    this.init();

    this.renderSmallView = mkContainerRenderHelper({
      Comp: ConnectedFMSynthUI,
      getProps: () => ({ synth: this }),
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
          // Initialize backend with all effects and modulation indices that were deserialized
          this.operatorConfigs.forEach((config, opIx) =>
            this.handleOperatorConfigChange(opIx, config)
          );
          this.operatorEffects.forEach((effectsForOp, opIx) => {
            effectsForOp.forEach((effect, effectIx) => {
              this.setEffect(opIx, effectIx, effect);
            });
          });
          this.mainEffectChain.forEach((effect, effectIx) =>
            this.setEffect(null, effectIx, effect)
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

  private encodeParamSource(source: ParamSource) {
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
      ...this.encodeParamSource(source),
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
            return this.encodeParamSource(config.stretchFactor);
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

  private encodeEffect(effect: Effect | null) {
    if (!effect) {
      return [-1, null, null, null, null];
    }

    switch (effect.type) {
      case 'spectral warping': {
        return [
          0,
          this.encodeParamSource(effect.frequency),
          this.encodeParamSource(effect.warpFactor),
          null,
          null,
        ];
      }
      case 'wavecruncher': {
        return [
          1,
          this.encodeParamSource(effect.topFoldPosition),
          this.encodeParamSource(effect.topFoldWidth),
          this.encodeParamSource(effect.bottomFoldPosition),
          this.encodeParamSource(effect.bottomFoldWidth),
        ];
      }
      case 'bitcrusher': {
        return [
          2,
          this.encodeParamSource(effect.sampleRate),
          this.encodeParamSource(effect.bitDepth),
          null,
          null,
        ];
      }
      case 'wavefolder': {
        return [
          3,
          this.encodeParamSource(effect.gain),
          this.encodeParamSource(effect.offset),
          null,
          null,
        ];
      }
      case 'soft clipper': {
        return [
          4,
          this.encodeParamSource(effect.preGain),
          this.encodeParamSource(effect.postGain),
          null,
          null,
        ];
      }
      default: {
        throw new UnimplementedError(`Effect not handled yet: ${(effect as any).type}`);
      }
    }
  }

  public setEffect(operatorIx: number | null, effectIx: number, newEffect: Effect | null) {
    if (!this.awpHandle) {
      console.error('Tried to set effect before AWP initialization');
      return;
    }
    if (operatorIx === null) {
      this.mainEffectChain[effectIx] = newEffect;
    } else {
      this.operatorEffects[operatorIx][effectIx] = newEffect;
    }

    const [effectType, param1, param2, param3, param4] = this.encodeEffect(newEffect);

    this.awpHandle.port.postMessage({
      type: 'setEffect',
      operatorIx,
      effectIx,
      effectType,
      param1,
      param2,
      param3,
      param4,
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
    if (params.operatorEffects) {
      this.operatorEffects = params.operatorEffects;
    }
    if (params.mainEffectChain) {
      this.mainEffectChain = params.mainEffectChain;
    }
  }

  public serialize() {
    return {
      modulationIndices: this.modulationIndices,
      outputWeights: this.outputWeights,
      operatorConfigs: this.operatorConfigs,
      operatorEffects: this.operatorEffects,
      selectedOperatorIx: this.selectedOperatorIx,
      mainEffectChain: this.mainEffectChain,
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
