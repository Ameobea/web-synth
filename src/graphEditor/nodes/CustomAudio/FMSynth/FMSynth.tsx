import { Map as ImmMap } from 'immutable';
import { UnimplementedError, UnreachableException } from 'ameo-utils';

import { ConnectedFMSynthUI, UISelection } from 'src/fmSynth/FMSynthUI';
import { buildDefaultOperatorConfig, OperatorConfig } from 'src/fmSynth/ConfigureOperator';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { ParamSource, buildDefaultAdsr } from 'src/fmSynth/ConfigureParamSource';
import type { Effect } from 'src/fmSynth/ConfigureEffects';
import { AsyncOnce } from 'src/util';

type FMSynthInputDescriptor =
  | { type: 'modulationValue'; srcOperatorIx: number; dstOperatorIx: number }
  | { type: 'outputWeight'; operatorIx: number };

const OPERATOR_COUNT = 8;
const VOICE_COUNT = 10;

const buildDefaultModulationIndices = (): ParamSource[][] => {
  const indices = new Array(OPERATOR_COUNT).fill(null);
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    indices[i] = new Array(OPERATOR_COUNT).fill(0).map(() => ({ type: 'constant', value: 0 }));
  }
  return indices;
};

const WavetableWasmBytes = new AsyncOnce(() =>
  fetch('/wavetable.wasm').then(res => res.arrayBuffer())
);

/**
 * Corresponds to `RampFn` in the Wasm engine
 */
export type RampFn =
  | { type: 'linear' }
  | { type: 'instant' }
  | { type: 'exponential'; exponent: number };

/**
 * Corresponds to `AdsrStep` in the Wasm engine
 */
export interface AdsrStep {
  x: number;
  y: number;
  ramper: RampFn;
}

/**
 * Corresponds to `Adsr` in the Wasm engine
 */
export interface Adsr {
  steps: AdsrStep[];
  lenSamples: number;
  loopPoint: number | null;
  releasePoint: number;
}

export default class FMSynth implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private generatedInputs: FMSynthInputDescriptor[] = []; // TODO: Populate this rather than expose raw indexed param buffers
  private awpHandle: AudioWorkletNode | null = null;
  private modulationMatrix: ParamSource[][] = buildDefaultModulationIndices();
  private outputWeights: number[] = new Array(OPERATOR_COUNT).fill(0);
  private operatorConfigs: OperatorConfig[] = new Array(OPERATOR_COUNT)
    .fill(undefined as any)
    .map(buildDefaultOperatorConfig);
  private operatorEffects: (Effect | null)[][] = new Array(OPERATOR_COUNT)
    .fill(null as any)
    .map(() => new Array(16).fill(null));
  private mainEffectChain: (Effect | null)[] = new Array(16).fill(null);
  private adsrs: Adsr[] = [buildDefaultAdsr()];
  public selectedUI: UISelection | null = null;
  private onInitialized: ((connectables: AudioConnectables) => void) | undefined;

  static typeName = 'FM Synthesizer';
  public nodeType = 'customAudio/fmSynth';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  public getModulationMatrix() {
    return this.modulationMatrix;
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
  public getAdsrs() {
    return this.adsrs;
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

  private encodeAdsrStep(step: AdsrStep) {
    const param = step.ramper.type === 'exponential' ? step.ramper.exponent : 0;
    const ramper = { linear: 0, instant: 1, exponential: 2 }[step.ramper.type];
    return { x: step.x, y: step.y, ramper, param };
  }

  private encodeAdsr(adsr: Adsr, adsrIx: number) {
    return {
      adsrIx,
      steps: adsr.steps.map(step => this.encodeAdsrStep(step)),
      lenSamples: adsr.lenSamples,
      releasePoint: adsr.releasePoint,
      loopPoint: adsr.loopPoint,
    };
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
      modulationMatrix: this.modulationMatrix.map(row =>
        row.map(cell => this.encodeParamSource(cell))
      ),
      outputWeights: this.outputWeights,
      adsrs: this.adsrs.map((adsr, adsrIx) => this.encodeAdsr(adsr, adsrIx)),
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

  public onGate(voiceIx: number) {
    if (!this.awpHandle) {
      console.warn('Tried gating before AWP initialized');
      return;
    }
    this.awpHandle.port.postMessage({ type: 'gate', voiceIx });
  }

  public onUnGate(voiceIx: number) {
    if (!this.awpHandle) {
      console.warn('Tried ungating before AWP initialized');
      return;
    }
    this.awpHandle.port.postMessage({ type: 'ungate', voiceIx });
  }

  private encodeParamSource(source: ParamSource) {
    switch (source.type) {
      case 'base frequency multiplier': {
        return {
          valueType: 3,
          valParamInt: 0,
          valParamFloat: source.multiplier,
          valParamFloat2: 0,
        };
      }
      case 'constant': {
        return {
          valueType: 1,
          valParamInt: 0,
          valParamFloat: source.value,
          valParamFloat2: 0,
        };
      }
      case 'adsr': {
        return {
          valueType: 2,
          valParamInt: source['adsr index'],
          valParamFloat: source.scale,
          valParamFloat2: source.shift,
        };
      }
      case 'param buffer': {
        return {
          valueType: 0,
          valParamInt: source['buffer index'],
          valParamFloat: 0,
          valParamFloat2: 0,
        };
      }

      default: {
        throw new UnimplementedError(
          `frequency source not yet implemented: ${(source as any).type}`
        );
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
            return { valueType: 0, valParamInt: 0, valParamFloat: 0, valParamFloat2: 0 };
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
      valParamFloat2: 0,
    });
  }

  public handleModulationIndexChange(
    srcOperatorIx: number,
    dstOperatorIx: number,
    val: ParamSource
  ) {
    if (!this.awpHandle) {
      console.error('Tried to update modulation before AWP initialization');
      return;
    }

    this.modulationMatrix[srcOperatorIx][dstOperatorIx] = val;

    this.awpHandle.port.postMessage({
      type: 'setModulationIndex',
      srcOperatorIx,
      dstOperatorIx,
      ...this.encodeParamSource(val),
    });
  }

  public handleAdsrChange(adsrIx: number, newAdsr: Adsr) {
    if (!this.awpHandle) {
      console.error('Tried to set ADSR before AWP initialization');
      return;
    }

    this.adsrs[adsrIx] = newAdsr;

    this.awpHandle.port.postMessage({
      type: 'setAdsr',
      adsrIx,
      steps: newAdsr.steps.map(step => this.encodeAdsrStep(step)),
      lenSamples: newAdsr.lenSamples,
      releasePoint: newAdsr.releasePoint,
      loopPoint: newAdsr.loopPoint,
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
    if (params.modulationMatrix) {
      this.modulationMatrix = params.modulationMatrix;
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
    if (params.selectedUI) {
      this.selectedUI = params.selectedUI;
    }
    if (params.adsrs) {
      this.adsrs = params.adsrs;
    }
  }

  public serialize() {
    return {
      modulationMatrix: this.modulationMatrix,
      outputWeights: this.outputWeights,
      operatorConfigs: this.operatorConfigs,
      operatorEffects: this.operatorEffects,
      selectedUI: this.selectedUI,
      mainEffectChain: this.mainEffectChain,
      adsrs: this.adsrs,
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
