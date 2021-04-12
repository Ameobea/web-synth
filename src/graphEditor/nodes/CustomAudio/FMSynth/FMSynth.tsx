import { Map as ImmMap } from 'immutable';
import { UnimplementedError, UnreachableException } from 'ameo-utils';
import * as R from 'ramda';

import { ConnectedFMSynthUI, UISelection } from 'src/fmSynth/FMSynthUI';
import { buildDefaultOperatorConfig, OperatorConfig } from 'src/fmSynth/ConfigureOperator';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { ParamSource, buildDefaultAdsr } from 'src/fmSynth/ConfigureParamSource';
import type { Effect } from 'src/fmSynth/ConfigureEffects';
import { AsyncOnce } from 'src/util';
import { AudioThreadData } from 'src/controls/adsr2/adsr2';
import { getSentry } from 'src/sentry';
import MIDIControlValuesCache from 'src/graphEditor/nodes/CustomAudio/FMSynth/MIDIControlValuesCache';
import { MIDINode } from 'src/patchNetwork/midiNode';

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

// prettier-ignore
const getHasSIMDSupport = async () => WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,9,1,7,0,65,0,253,15,26,11]))

const WavetableWasmBytes = new AsyncOnce(
  async (): Promise<ArrayBuffer> => {
    const hasSIMDSupport = await getHasSIMDSupport();
    getSentry()?.setContext('wasmSIMDSupport', { hasWasmSIMDSupport: hasSIMDSupport });
    if (!window.location.href.includes('localhost')) {
      console.log(
        hasSIMDSupport
          ? 'Wasm SIMD support detected!'
          : 'Wasm SIMD support NOT detected; using fallback Wasm'
      );
    }
    const simdStatusElem = document.getElementById('simd-status');
    if (simdStatusElem) {
      if (hasSIMDSupport) {
        simdStatusElem.setAttribute('style', 'display:block; color: #08bf3f;');
      } else {
        simdStatusElem.innerHTML = 'SIMD support not detected; using non-SIMD Wasm';
        simdStatusElem.setAttribute('style', 'display:block; color: #cfeb1e;');
      }
    }
    const res = fetch(hasSIMDSupport ? '/wavetable.wasm' : '/wavetable_no_simd.wasm');
    return res.then(res => res.arrayBuffer());
  }
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
  audioThreadData: AudioThreadData;
}

const serializeADSR = (adsr: Adsr) => ({ ...adsr, audioThreadData: undefined });

export default class FMSynth implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private generatedInputs: FMSynthInputDescriptor[] = []; // TODO: Populate this rather than expose raw indexed param buffers
  private awpHandle: AudioWorkletNode | null = null;
  private modulationMatrix: ParamSource[][] = buildDefaultModulationIndices();
  private outputWeights: ParamSource[] = new Array(OPERATOR_COUNT)
    .fill(null as any)
    .map(() => ({ type: 'constant' as const, value: 0 }));
  private operatorConfigs: OperatorConfig[] = new Array(OPERATOR_COUNT)
    .fill(undefined as any)
    .map(buildDefaultOperatorConfig);
  private operatorEffects: (Effect | null)[][] = new Array(OPERATOR_COUNT)
    .fill(null as any)
    .map(() => new Array(16).fill(null));
  private mainEffectChain: (Effect | null)[] = new Array(16).fill(null);
  private adsrs: Adsr[] = [buildDefaultAdsr()];
  public selectedUI: UISelection | null = null;
  private onInitialized: ((inst: FMSynth) => void) | undefined;
  private audioThreadDataBuffer: Float32Array | null = null;
  private detune: ParamSource | null = null;
  public midiControlValuesCache: MIDIControlValuesCache;

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
  public getDetune() {
    return this.detune;
  }

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    if (params) {
      this.deserialize(params);
    }
    const midiNode =
      params?.midiNode ??
      new MIDINode(() => ({
        onAttack: () => {
          // ignore
        },
        onRelease: () => {
          // ignore
        },
        onPitchBend: () => {
          // ignore
        },
        onClearAll: () => {
          // ignore
        },
        onGenericControl: () => {
          // ignore
        },
      }));
    this.midiControlValuesCache = new MIDIControlValuesCache(
      params?.lastSeenMIDIControlValues ?? {},
      midiNode,
      this
    );

    this.init();

    this.renderSmallView = mkContainerRenderHelper({
      Comp: ConnectedFMSynthUI,
      getProps: () => ({
        synth: this,
        midiNode,
        getFMSynthOutput: () => {
          throw new UnimplementedError();
        },
      }),
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

  public async init() {
    const [wasmBytes] = await Promise.all([
      WavetableWasmBytes.get(),
      this.ctx.audioWorklet.addModule(
        window.location.href.includes('localhost')
          ? '/FMSynthAWP.js'
          : '/FMSynthAWP.js?randId=' + btoa(Math.random().toString())
      ),
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
      outputWeights: this.outputWeights.map(ps => this.encodeParamSource(ps)),
      adsrs: this.adsrs.map((adsr, adsrIx) => this.encodeAdsr(adsr, adsrIx)),
    });

    this.awpHandle.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'wasmInitialized': {
          if (evt.data.audioThreadDataBuffer) {
            this.audioThreadDataBuffer = new Float32Array(
              evt.data.audioThreadDataBuffer as SharedArrayBuffer
            );
            this.adsrs.forEach(adsr => {
              adsr.audioThreadData.buffer = this.audioThreadDataBuffer!;
            });
          }

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
          this.handleDetuneChange(this.detune);

          if (this.onInitialized) {
            this.onInitialized(this);
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

  private encodeParamSource(source: ParamSource | null | undefined) {
    if (!source) {
      return { valueType: -1, valParamInt: 0, valParamFloat: 0, valParamFloat2: 0 };
    }

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
      case 'midi control': {
        return {
          valueType: 4,
          valParamInt: source.midiControlIndex,
          valParamFloat: source.scale,
          valParamFloat2: source.shift,
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
    this.operatorConfigs[operatorIx] = R.clone(config);
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
        'square oscillator': 4,
        'triangle oscillator': 5,
        'sawtooth oscillator': 6,
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
      case 'sine oscillator':
      case 'exponential oscillator':
      case 'square oscillator':
      case 'triangle oscillator':
      case 'sawtooth oscillator': {
        this.setOperatorBaseFrequencySource(operatorIx, config.frequency);
        break;
      }
    }
  }

  public handleOutputWeightChange(operatorIx: number, rawVal: ParamSource | number) {
    if (!this.awpHandle) {
      console.error('Tried to update output weights before AWP initialization');
      return;
    }
    const value =
      typeof rawVal === 'number' ? { type: 'constant' as const, value: rawVal } : R.clone(rawVal);
    if (value.type === 'constant' && typeof value.value !== 'number') {
      value.value = 0;
    }

    this.outputWeights[operatorIx] = value;

    this.awpHandle.port.postMessage({
      type: 'setOutputWeightValue',
      operatorIx,
      ...this.encodeParamSource(value),
    });
  }

  public handleModulationIndexChange(
    srcOperatorIx: number,
    dstOperatorIx: number,
    rawVal: ParamSource
  ) {
    if (!this.awpHandle) {
      console.error('Tried to update modulation before AWP initialization');
      return;
    }
    const val = R.clone(rawVal);
    if (val.type === 'constant' && Math.abs(val.value) < 0.001) {
      val.value = 0;
    }

    this.modulationMatrix[srcOperatorIx][dstOperatorIx] = val;

    this.awpHandle.port.postMessage({
      type: 'setModulationIndex',
      srcOperatorIx,
      dstOperatorIx,
      ...this.encodeParamSource(val),
    });
  }

  public handleAdsrChange(adsrIx: number, newAdsrRaw: Omit<Adsr, 'audioThreadData'>) {
    if (!this.awpHandle) {
      console.error('Tried to set ADSR before AWP initialization');
      return;
    }

    const isLenOnlyChange =
      this.adsrs[adsrIx] && this.adsrs[adsrIx].lenSamples !== newAdsrRaw.lenSamples;
    const newAdsr = R.clone({ ...newAdsrRaw, audioThreadData: undefined });
    this.adsrs[adsrIx] = {
      ...newAdsr,
      audioThreadData: {
        phaseIndex: adsrIx,
        buffer: this.audioThreadDataBuffer ?? undefined,
      },
    };

    if (isLenOnlyChange) {
      this.awpHandle.port.postMessage({
        type: 'setAdsrLength',
        adsrIx,
        lenSamples: newAdsr.lenSamples,
      });
    } else {
      this.awpHandle.port.postMessage({
        type: 'setAdsr',
        adsrIx,
        steps: newAdsr.steps.map(step => this.encodeAdsrStep(step)),
        lenSamples: newAdsr.lenSamples,
        releasePoint: newAdsr.releasePoint,
        loopPoint: newAdsr.loopPoint,
      });
    }
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
          {
            valueType: -1,
            valParamInt: effect.algorithm,
            valParamFloat: 0,
            valParamFloat2: 0,
          },
          null,
        ];
      }
      case 'butterworth filter': {
        return [
          5,
          {
            valueType: -1,
            valParamInt: effect.mode,
            valParamFloat: 0,
            valParamFloat2: 0,
          },
          this.encodeParamSource(effect.cutoffFrequency),
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
      this.mainEffectChain[effectIx] = R.clone(newEffect);
    } else {
      this.operatorEffects[operatorIx][effectIx] = R.clone(newEffect);
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

  public deserialize(params: { [key: string]: any }) {
    if (params.modulationMatrix) {
      this.modulationMatrix = params.modulationMatrix;
      this.modulationMatrix.forEach(row =>
        row.forEach(ps => {
          if (ps.type === 'constant' && Math.abs(ps.value) < 0.001) {
            ps.value = 0;
          }
        })
      );
    }
    if (params.outputWeights) {
      if (typeof params.outputWeights[0] === 'number') {
        this.outputWeights = params.outputWeights.map((value: number) => ({
          type: 'constant' as const,
          value: Math.abs(value) < 0.001 ? 0 : value,
        }));
      } else {
        this.outputWeights = params.outputWeights;
        this.outputWeights.forEach(val => {
          if (val.type === 'constant' && typeof val.value !== 'number') {
            val.value = 0;
          } else if (val.type == 'constant' && Math.abs(val.value) < 0.001) {
            val.value = 0;
          }
        });
      }
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
      this.adsrs = params.adsrs.map(
        (adsr: Exclude<Adsr, 'audioThreadData'>, i: number): Adsr => ({
          ...adsr,
          audioThreadData: { phaseIndex: i },
        })
      );
    }
    if (params.detune) {
      this.detune = params.detune;
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
      adsrs: this.adsrs.map(serializeADSR),
      detune: this.detune,
      lastSeenMIDIControlValues: this.midiControlValuesCache.serialize(),
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

  public handleDetuneChange(newDetune: ParamSource | null) {
    this.detune = R.clone(newDetune);
    if (!this.awpHandle) {
      console.warn('Tried to set FM synth detune before AWP initialized');
      return;
    }

    this.awpHandle.port.postMessage({ type: 'setDetune', ...this.encodeParamSource(newDetune) });
  }

  public setMIDIControlValue(controlIndex: number, controlValue: number) {
    if (!this.awpHandle) {
      console.warn('Tried to set MIDI control value before AWP initialized');
      return;
    }
    this.awpHandle.port.postMessage({ type: 'midiControlValue', controlIndex, controlValue });
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
