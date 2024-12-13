import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import * as React from 'react';
import { get, writable, type Writable } from 'svelte/store';

import type { AudioThreadData } from 'src/controls/adsr2/adsr2';
import {
  buildDefaultOperatorConfig,
  deserializeWavetableState,
  serializeWavetableState,
  type OperatorConfig,
  type WavetableBank,
  type WavetableState,
} from 'src/fmSynth/ConfigureOperator';
import { encodeEffect, type Effect } from 'src/fmSynth/Effect';
import { ConnectedFMSynthUI, type UISelection } from 'src/fmSynth/FMSynthUI';
import type { GateUngateCallbackRegistrar } from 'src/fmSynth/midiSampleUI/types';
import {
  buildDefaultAdsr,
  buildDefaultParamSource,
  encodeParamSource,
  type ParamSource,
} from 'src/fmSynth/ParamSource';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import MIDIControlValuesCache from 'src/graphEditor/nodes/CustomAudio/FMSynth/MIDIControlValuesCache';
import {
  buildDefaultSampleMappingState,
  deserializeSampleMappingState,
  serializeSampleMappingState,
  type SampleMappingState,
} from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';
import { WavetableWasmBytes } from 'src/graphEditor/nodes/CustomAudio/WaveTable/WavetableWasm';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { MIDINode } from 'src/patchNetwork/midiNode';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { getSample, hashSampleDescriptor, type SampleDescriptor } from 'src/sampleLibrary';
import { getSentry } from 'src/sentry';
import { AsyncOnce, normalizeEnvelope, UnimplementedError, UnreachableError } from 'src/util';
import { EventSchedulerInitialized } from 'src/eventScheduler';
import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { buildDefaultFilter } from 'src/synthDesigner/filterHelpersLight';
import { FilterType } from 'src/synthDesigner/FilterType';

const OPERATOR_COUNT = 8;

const ctx = new AudioContext();

const RegisterFMSynthAWP = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        (window.location.href.includes('localhost')
          ? 'FMSynthAWP.js'
          : 'FMSynthAWP.js?randId=' + btoa(Math.random().toString()))
    ),
  true
);

const buildDefaultModulationIndices = (): ParamSource[][] => {
  const indices = new Array(OPERATOR_COUNT).fill(null);
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    indices[i] = new Array(OPERATOR_COUNT).fill(0).map(() => ({ type: 'constant', value: 0 }));
  }
  return indices;
};

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
  /**
   * Normalized between 0 and 1
   */
  x: number;
  /**
   * Normalized between 0 and 1
   */
  y: number;
  ramper: RampFn;
}

export enum AdsrLengthMode {
  Samples,
  Beats,
}

/**
 * Corresponds to `Adsr` in the Wasm engine
 */
export interface Adsr {
  steps: AdsrStep[];
  /**
   * This will be interpreted differently if `lengthMode` is set to a value
   * other than `AdsrLengthMode.Samples`
   */
  lenSamples: number;
  lengthMode?: AdsrLengthMode;
  loopPoint: number | null;
  releasePoint: number;
  audioThreadData: AudioThreadData;
  logScale?: boolean;
}

export interface AdsrParams {
  steps: AdsrStep[];
  lenSamples: ParamSource;
  loopPoint: number | null; // TODO: ParamSource
  releasePoint: number; // TODO: ParamSource
  logScale?: boolean;
  audioThreadData: AudioThreadData;
}

const serializeADSR = (adsr: AdsrParams) => ({
  ...adsr,
  lenSamples:
    typeof adsr.lenSamples === 'number'
      ? { type: 'constant' as const, value: adsr.lenSamples }
      : adsr.lenSamples,
  audioThreadData: { phaseIndex: 0, debugName: 'serializeAdsr' },
});

interface ADSRParamsWithLenSamples extends AdsrParams {
  lenSamples: { type: 'constant'; value: number } | { type: 'beats to samples'; value: number };
}

export enum FilterParamControlSource {
  /**
   * Controlled directly by the filter UI
   */
  Manual = 0,
  /**
   * Controlled by the ADSR/envelope generator defined in the UI
   */
  Envelope = 1,
  /**
   * Controlled incoming CV from a different module connected to the filter
   */
  PatchNetwork = 2,
}

export default class FMSynth implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private audioThreadMIDIEventMailboxID?: string;
  private awpHandle: AudioWorkletNode | null = null;
  private modulationMatrix: ParamSource[][] = buildDefaultModulationIndices();
  private outputWeights: ParamSource[] = new Array(OPERATOR_COUNT)
    .fill(null as any)
    .map(() => ({ type: 'constant' as const, value: 0 }));
  private logScale = false;
  private operatorConfigs: OperatorConfig[] = new Array(OPERATOR_COUNT)
    .fill(undefined as any)
    .map(buildDefaultOperatorConfig);
  private operatorEffects: (Effect | null)[][] = new Array(OPERATOR_COUNT)
    .fill(null as any)
    .map(() => new Array(16).fill(null));
  private mainEffectChain: (Effect | null)[] = new Array(16).fill(null);
  private adsrs: AdsrParams[] = [buildDefaultAdsr()];
  public selectedUI: UISelection | null = null;
  private onInitializedCBs: ((inst: FMSynth) => void)[] = [];
  private audioThreadDataBuffer: Float32Array | null = null;
  private detune: ParamSource | null = null;
  private masterGain = 1;
  public midiControlValuesCache: MIDIControlValuesCache;
  private wavetableState: WavetableState = { wavetableBanks: [] };
  private wavetableBackendIxByName: string[] = [];
  private lastSetWavetableData: {
    wavetableIx: number;
    waveformsPerDimension: number;
    waveformLength: number;
    baseFrequency: number;
    samples: Float32Array;
  } = {
    wavetableIx: -1,
    waveformsPerDimension: -1,
    waveformLength: -1,
    baseFrequency: -1,
    samples: new Float32Array(0),
  };
  private sampleMappingStore: Writable<SampleMappingState> = writable(
    buildDefaultSampleMappingState()
  );
  public gainEnvelope: ADSRParamsWithLenSamples = {
    steps: [
      { x: 0, y: 0, ramper: { type: 'instant' } },
      { x: 0.02, y: 0.65, ramper: { type: 'exponential', exponent: 1 } },
      { x: 0.09, y: 0.6, ramper: { type: 'exponential', exponent: 1 } },
      { x: 0.98, y: 0.6, ramper: { type: 'exponential', exponent: 1 } },
      { x: 1, y: 0, ramper: { type: 'exponential', exponent: 1 } },
    ],
    lenSamples: { type: 'constant', value: 44_100 / 2 },
    loopPoint: null,
    releasePoint: 0.98,
    audioThreadData: { phaseIndex: 255 },
  };
  public filterEnvelope: ADSRParamsWithLenSamples = {
    steps: [
      { x: 0, y: 0.8, ramper: { type: 'exponential', exponent: 0.5 } },
      { x: 0.04, y: 0.5, ramper: { type: 'exponential', exponent: 0.5 } },
      { x: 1, y: 0.5, ramper: { type: 'exponential', exponent: 0.5 } },
    ],
    lenSamples: { type: 'constant', value: 44_100 / 2 },
    loopPoint: null,
    releasePoint: 0.7,
    audioThreadData: { phaseIndex: 254 },
    logScale: true,
  };
  private filterBypassed = true;
  private filterParams: FilterParams = buildDefaultFilter(FilterType.Lowpass, 1);
  /**
   * For each key, true if the corresponding param is being controlled manually using the
   * filter UI.  Fals
   */
  private filterParamControlSources: {
    Q: FilterParamControlSource;
    frequency: FilterParamControlSource;
    gain: FilterParamControlSource;
  } = {
    Q: FilterParamControlSource.Manual,
    frequency: FilterParamControlSource.Manual,
    gain: FilterParamControlSource.Manual,
  };
  private gateCallbacks: Set<(midiNumber: number, voiceIx: number) => void> = new Set();
  private ungateCallbacks: Set<(midiNumber: number, voiceIx: number) => void> = new Set();
  private fetchedSampleDescriptorHashes: Set<string> = new Set();
  public useLegacyWavetableControls = true;
  public readonly debugID = genRandomStringID();

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
  public getWavetableState() {
    return this.wavetableState;
  }
  public setWavetableState(newState: WavetableState) {
    this.wavetableState = newState;
  }

  public get mailboxID() {
    return this.audioThreadMIDIEventMailboxID;
  }

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;
    this.audioThreadMIDIEventMailboxID = params?.audioThreadMIDIEventMailboxID;

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

    this.init().catch(err => {
      console.error('Error initializing FMSynth', err);
      getSentry()?.captureException(err);
    });

    const FMSynthSmallView: React.FC<any> = props => (
      <div>
        <div style={{ color: '#ee6666', padding: 4 }}>
          <strong>Note</strong>: This standalone FM synth node only exists for legacy purposes. It
          is likely broken and should no longer be used.
          <br />
          <br />
          Use the <strong>Synth Designer</strong> instead, which embeds this FM synth along with a
          bunch of other functionality.
        </div>
        <ConnectedFMSynthUI {...props} />
      </div>
    );

    this.renderSmallView = mkContainerRenderHelper({
      Comp: FMSynthSmallView,
      getProps: () => ({
        synth: this,
        midiNode,
        getFMSynthOutput: () => {
          throw new UnimplementedError();
        },
        synthID: vcId ?? '',
        isHidden: false,
        vcId,
      }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  private encodeAdsrStep(step: AdsrStep) {
    const param = step.ramper.type === 'exponential' ? step.ramper.exponent : 0;
    const ramper = { linear: 0, instant: 1, exponential: 2 }[step.ramper.type];
    return { x: step.x, y: step.y, ramper, param };
  }

  private encodeAdsr(adsr: AdsrParams, adsrIx: number) {
    return {
      adsrIx,
      steps: adsr.steps.map(step => this.encodeAdsrStep(step)),
      lenSamples: encodeParamSource(adsr.lenSamples),
      releasePoint: adsr.releasePoint,
      loopPoint: adsr.loopPoint,
      logScale: adsr.logScale ?? false,
    };
  }

  public async init() {
    const [wasmBytes] = await Promise.all([
      WavetableWasmBytes.get(),
      RegisterFMSynthAWP.get(),
      EventSchedulerInitialized,
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'fm-synth-audio-worklet-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
      processorOptions: { mailboxID: this.audioThreadMIDIEventMailboxID },
    });

    this.awpHandle.port.postMessage({
      type: 'setWasmBytes',
      logScale: this.logScale,
      wasmBytes,
      modulationMatrix: this.modulationMatrix.map(row => row.map(cell => encodeParamSource(cell))),
      outputWeights: this.outputWeights.map(ps => encodeParamSource(ps)),
      adsrs: [
        this.encodeAdsr(this.gainEnvelope, -1),
        this.encodeAdsr(this.filterEnvelope, -2),
        ...this.adsrs.map((adsr, adsrIx) => this.encodeAdsr(adsr, adsrIx)),
      ],
      debugID: this.debugID,
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
            this.gainEnvelope.audioThreadData.buffer = this.audioThreadDataBuffer!;
            this.filterEnvelope.audioThreadData.buffer = this.audioThreadDataBuffer!;
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
          this.setFilterBypassed(this.filterBypassed);
          this.setFilterParams(this.filterParams);
          this.setMasterGain(this.masterGain);
          this.sampleMappingStore.subscribe(this.handleSampleMappingStateChange);

          for (const cb of this.onInitializedCBs) {
            cb(this);
          }
          break;
        }
        case 'onGate': {
          for (const gateCb of this.gateCallbacks) {
            gateCb(evt.data.midiNumber, evt.data.voiceIx);
          }
          break;
        }
        case 'onUngate': {
          for (const ungateCb of this.ungateCallbacks) {
            ungateCb(evt.data.midiNumber, evt.data.voiceIx);
          }
          break;
        }
        default: {
          console.error('Unhandled event type from FM synth AWP: ', evt.data.type);
        }
      }
    };

    if (this.vcId) {
      (window as any).updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private maybeLoadWavetableIntoBackend(bank: WavetableBank) {
    const loadedIndex = this.wavetableBackendIxByName.findIndex(n => n === bank.name);

    const backendIx = loadedIndex === -1 ? this.wavetableBackendIxByName.length : loadedIndex;
    if (loadedIndex === -1) {
      this.wavetableBackendIxByName.push(bank.name);
    }

    const setWavetableData = {
      wavetableIx: backendIx,
      waveformsPerDimension: bank.waveformsPerDimension,
      waveformLength: bank.samplesPerWaveform,
      baseFrequency: bank.baseFrequency,
      samples: bank.samples,
    };
    if (
      this.lastSetWavetableData.wavetableIx === setWavetableData.wavetableIx &&
      this.lastSetWavetableData.baseFrequency === setWavetableData.baseFrequency &&
      this.lastSetWavetableData.waveformsPerDimension === setWavetableData.waveformsPerDimension &&
      this.lastSetWavetableData.waveformLength === setWavetableData.waveformLength &&
      this.lastSetWavetableData.samples.length === setWavetableData.samples.length &&
      this.lastSetWavetableData.samples.every((s, ix) => s === setWavetableData.samples[ix])
    ) {
      return;
    }

    if (!this.awpHandle) {
      console.error('Tried to load wavetable into backend before AWP initialized');
      return;
    }

    this.lastSetWavetableData = setWavetableData;
    this.awpHandle.port.postMessage({
      type: 'setWavetableData',
      wavetableIx: backendIx,
      waveformsPerDimension: bank.waveformsPerDimension,
      waveformLength: bank.samplesPerWaveform,
      baseFrequency: bank.baseFrequency,
      samples: bank.samples,
    });
  }

  public registerGateUngateCallbacks: GateUngateCallbackRegistrar = (onGate, onUngate) => {
    this.gateCallbacks.add(onGate);
    this.ungateCallbacks.add(onUngate);

    const unregister = () => {
      this.gateCallbacks.delete(onGate);
      this.ungateCallbacks.delete(onUngate);
    };
    return { unregister };
  };

  private setOperatorBaseFrequencySource(operatorIx: number, source: ParamSource) {
    if (!this.awpHandle) {
      throw new UnreachableError();
    }

    this.awpHandle.port.postMessage({
      type: 'setOperatorBaseFrequencySource',
      operatorIx,
      ...encodeParamSource(source),
    });
  }

  public getSampleMappingStore(): Writable<SampleMappingState> {
    return this.sampleMappingStore;
  }

  public handleOperatorConfigChange(operatorIx: number, config: OperatorConfig) {
    this.operatorConfigs[operatorIx] = R.clone(config);
    if (!this.awpHandle) {
      console.warn('Tried to update operator config before awp initialized');
      return;
    }

    if (config.type === 'wavetable' && config.wavetableName !== null) {
      const bank = this.wavetableState.wavetableBanks.find(R.propEq(config.wavetableName, 'name'));
      if (!bank) {
        console.error(
          `Wavetable bank ${config.wavetableName} not found in wavetable state but was referenced by operator ix=${operatorIx}`
        );
      } else {
        this.maybeLoadWavetableIntoBackend(bank);
      }
    }

    const unisonEnabled = !R.isNil((config as any).unison) && +(config as any).unison > 1;
    const { unison, unisonDetune }: { unison: number | null; unisonDetune: ParamSource | null } =
      unisonEnabled
        ? { unison: (config as any).unison, unisonDetune: (config as any).unisonDetune }
        : { unison: null, unisonDetune: null };

    const operatorType =
      {
        wavetable: 0,
        'sine oscillator': 2,
        'exponential oscillator': 3,
        'param buffer': 1,
        'square oscillator': 4,
        'triangle oscillator': 5,
        'sawtooth oscillator': 6,
        'sample mapping': 7,
        'tuned sample': 8,
        'white noise': 9,
      }[config.type] + (unisonEnabled ? 50 : 0);

    // Set the operator config along with any hyperparam config
    this.awpHandle.port.postMessage({
      type: 'setOperatorConfig',
      operatorIx,
      operatorType,
      unison: unison ?? 1,
      unisonPhaseRandomizationEnabled: (config as any).unisonPhaseRandomization?.enabled ?? false,
      ...(() => {
        switch (config.type) {
          case 'exponential oscillator':
            return { param1: encodeParamSource(config.stretchFactor) };
          case 'wavetable':
            return {
              param1: {
                valParamInt:
                  this.wavetableBackendIxByName.findIndex(x => x === config.wavetableName) ?? 1000,
              },
              param2: encodeParamSource(config.dim0IntraMix),
              param3: encodeParamSource(config.dim1IntraMix),
              param4: encodeParamSource(config.interDimMix),
              param5: unisonDetune ? encodeParamSource(unisonDetune) : null,
            };
          default: {
            if (!unisonDetune) {
              return {};
            }

            return {
              param5: encodeParamSource(unisonDetune),
            };
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
      case 'sawtooth oscillator':
      case 'wavetable': {
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
      ...encodeParamSource(value),
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
      ...encodeParamSource(val),
    });
  }

  public setFilterBypassed(isBypassed: boolean) {
    this.filterBypassed = isBypassed;
    this.awpHandle?.port.postMessage({ type: 'setFilterBypassed', isBypassed });
  }

  private encodeFilterType(filterType: FilterType): number {
    return {
      [FilterType.Lowpass]: 0,
      [FilterType.LP4]: 1,
      [FilterType.LP8]: 2,
      [FilterType.LP16]: 3,
      [FilterType.Highpass]: 4,
      [FilterType.HP4]: 5,
      [FilterType.HP8]: 6,
      [FilterType.HP16]: 7,
      [FilterType.Bandpass]: 8,
      [FilterType.BP4]: 9,
      [FilterType.BP8]: 10,
      [FilterType.BP16]: 11,
      [FilterType.DynaBP_50]: 12,
      [FilterType.DynaBP_100]: 13,
      [FilterType.DynaBP_200]: 14,
      [FilterType.DynaBP_400]: 15,
      [FilterType.DynaBP_800]: 16,
      [FilterType.Lowshelf]: 17,
      [FilterType.Highshelf]: 18,
      [FilterType.Peaking]: 19,
      [FilterType.Notch]: 20,
      [FilterType.Allpass]: 21,
    }[filterType];
  }

  public handleFilterTypeChange(newFilterType: FilterType) {
    this.filterParams.type = newFilterType;
    this.awpHandle?.port.postMessage({
      type: 'setFilterType',
      filterType: this.encodeFilterType(newFilterType),
    });
  }

  public handleFilterQChange(newManualQ: number, controlSource?: FilterParamControlSource) {
    this.filterParams.Q = newManualQ;
    if (!R.isNil(controlSource)) {
      this.filterParamControlSources.Q = controlSource;
    }
    this.awpHandle?.port.postMessage({
      type: 'setFilterQ',
      Q: newManualQ,
      controlSource: this.filterParamControlSources.Q,
    });
  }

  public handleFilterFrequencyChange(
    newManualFrequency: number,
    controlSource?: FilterParamControlSource
  ) {
    this.filterParams.frequency = newManualFrequency;
    if (!R.isNil(controlSource)) {
      this.filterParamControlSources.frequency = controlSource;
    }
    this.awpHandle?.port.postMessage({
      type: 'setFilterFrequency',
      frequency: newManualFrequency,
      controlSource: this.filterParamControlSources.frequency,
    });
  }

  public handleFilterGainChange(newManualGain: number, controlSource?: FilterParamControlSource) {
    this.filterParams.gain = newManualGain;
    if (!R.isNil(controlSource)) {
      this.filterParamControlSources.gain = controlSource;
    }
    this.awpHandle?.port.postMessage({
      type: 'setFilterGain',
      gain: newManualGain,
      controlSource: this.filterParamControlSources.gain,
    });
  }

  public setFilterParams(params: FilterParams) {
    this.handleFilterTypeChange(params.type);
    if (!R.isNil(params.Q)) {
      this.handleFilterQChange(params.Q, this.filterParamControlSources.Q);
    }
    if (!R.isNil(params.frequency)) {
      this.handleFilterFrequencyChange(params.frequency, this.filterParamControlSources.frequency);
    }
    if (!R.isNil(params.gain)) {
      this.handleFilterGainChange(params.gain, this.filterParamControlSources.gain);
    }
  }

  public setMasterGain(newMasterGain: number) {
    this.masterGain = newMasterGain;
    // Old behavior was to have a base gain of 1, but FM synth multiplies by it directly
    this.awpHandle?.port.postMessage({ type: 'setMasterGain', masterGain: 1 + newMasterGain });
  }

  public onInitialized(): Promise<FMSynth> {
    if (this.awpHandle) {
      return Promise.resolve(this);
    }

    return new Promise<FMSynth>(resolve => void this.onInitializedCBs.push(() => resolve(this)));
  }

  public handleAdsrChange(adsrIx: number, newAdsrRaw: AdsrParams) {
    if (!this.awpHandle) {
      console.error('Tried to set ADSR before AWP initialization');
      return;
    }

    if (typeof newAdsrRaw.lenSamples === 'number') {
      newAdsrRaw.lenSamples = { type: 'constant', value: newAdsrRaw.lenSamples };
    }

    const oldAdsr =
      adsrIx === -1 ? this.gainEnvelope : adsrIx === -2 ? this.filterEnvelope : this.adsrs[adsrIx];

    const isLenOnlyChange =
      oldAdsr &&
      !R.equals(oldAdsr.lenSamples, newAdsrRaw.lenSamples) &&
      R.equals(oldAdsr.steps, newAdsrRaw.steps) &&
      oldAdsr.releasePoint === newAdsrRaw.releasePoint &&
      oldAdsr.loopPoint === newAdsrRaw.loopPoint &&
      oldAdsr.logScale === newAdsrRaw.logScale;
    const newAdsr = {
      ...R.clone({ ...newAdsrRaw, audioThreadData: undefined }),
      audioThreadData: {
        phaseIndex: adsrIx >= 0 ? adsrIx : adsrIx === -1 ? 255 : 254,
        buffer: this.audioThreadDataBuffer ?? undefined,
        debugName: `handleAdsrChange adsrIx=${adsrIx}`,
      },
    };
    if (adsrIx === -1) {
      const newLenSamples = newAdsr.lenSamples;
      if (newLenSamples.type !== 'constant') {
        throw new UnreachableError('Only constant gain envelope length is supported');
      }
      this.gainEnvelope = { ...newAdsr, lenSamples: newLenSamples };
    } else if (adsrIx === -2) {
      if (
        newAdsr.lenSamples.type !== 'constant' &&
        newAdsr.lenSamples.type !== 'beats to samples'
      ) {
        throw new UnreachableError(
          'Only constant and beats to samples filter envelope length is supported'
        );
      }

      this.filterEnvelope = {
        ...newAdsr,
        lenSamples: newAdsr.lenSamples,
        audioThreadData: this.filterEnvelope.audioThreadData,
        logScale: true,
      };
    } else {
      this.adsrs[adsrIx] = newAdsr;
    }

    if (isLenOnlyChange) {
      this.awpHandle.port.postMessage({
        type: 'setAdsrLength',
        adsrIx,
        lenSamples: encodeParamSource(
          typeof newAdsr.lenSamples === 'number'
            ? { type: 'constant', value: newAdsr.lenSamples }
            : newAdsr.lenSamples
        ),
      });
    } else {
      this.awpHandle.port.postMessage({
        type: 'setAdsr',
        adsrIx,
        steps: newAdsr.steps.map(step => this.encodeAdsrStep(step)),
        lenSamples: encodeParamSource(newAdsr.lenSamples),
        releasePoint: newAdsr.releasePoint,
        loopPoint: newAdsr.loopPoint,
        logScale: newAdsr.logScale ?? false,
      });
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

    const [effectType, param1, param2, param3, param4] = encodeEffect(newEffect);

    this.awpHandle.port.postMessage({
      type: 'setEffect',
      operatorIx,
      effectIx,
      effectType,
      param1,
      param2,
      param3,
      param4,
      isBypassed: newEffect?.isBypassed ?? false,
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
      this.operatorConfigs = (params.operatorConfigs as OperatorConfig[]).map(op => {
        // Backwards compat
        if (
          op.type === 'sine oscillator' ||
          op.type === 'triangle oscillator' ||
          op.type === 'sawtooth oscillator' ||
          op.type === 'square oscillator' ||
          op.type === 'wavetable'
        ) {
          op.unison = op.unison ?? 1;
          op.unisonDetune = op.unisonDetune ?? buildDefaultParamSource('constant', 0, 300, 0);
          op.unisonPhaseRandomization = op.unisonPhaseRandomization ?? { enabled: false };
        }

        return op;
      });
    }
    if (params.onInitialized) {
      this.onInitializedCBs.push(params.onInitialized);
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
        (adsr: Exclude<Adsr, 'audioThreadData'>, i: number): AdsrParams => {
          const lenSamples =
            adsr.lenSamples && typeof adsr.lenSamples === 'object'
              ? adsr.lenSamples
              : { type: 'constant' as const, value: adsr.lenSamples };

          return {
            ...adsr,
            audioThreadData: { phaseIndex: i },
            lenSamples,
            logScale: adsr.logScale ?? false,
          };
        }
      );
    }
    if (params.detune) {
      this.detune = params.detune;
    }
    if (params.wavetableState) {
      this.wavetableState = deserializeWavetableState(params.wavetableState);
    }
    if (params.gainEnvelope && params.gainEnvelope.steps.length > 0) {
      const gainEnvelope = normalizeEnvelope(params.gainEnvelope);
      this.gainEnvelope = {
        ...gainEnvelope,
        lenSamples:
          typeof gainEnvelope.lenSamples === 'number'
            ? { type: 'constant', value: gainEnvelope.lenSamples }
            : gainEnvelope.lenSamples,
        audioThreadData: { phaseIndex: 255 },
      };
    }
    if (params.filterEnvelope && params.filterEnvelope.steps.length > 0) {
      const filterEnvelope = normalizeEnvelope(params.filterEnvelope);
      this.filterEnvelope = {
        ...filterEnvelope,
        lenSamples:
          typeof filterEnvelope.lenSamples === 'number'
            ? (filterEnvelope.lengthMode ?? AdsrLengthMode.Samples) === AdsrLengthMode.Samples
              ? { type: 'constant', value: filterEnvelope.lenSamples }
              : { type: 'beats to samples', value: filterEnvelope.lenSamples }
            : filterEnvelope.lenSamples,
        logScale: true,
      };
      this.filterEnvelope.audioThreadData.phaseIndex = 254;
    }
    if (params.sampleMappingState) {
      this.sampleMappingStore.set(deserializeSampleMappingState(params.sampleMappingState));
    }
    if (!R.isNil(params.useLegacyWavetableControls)) {
      this.useLegacyWavetableControls = params.useLegacyWavetableControls;
    }
    if (!R.isNil(params.filterBypassed)) {
      this.setFilterBypassed(params.filterBypassed);
    }
    if (!R.isNil(params.filterParamControlSources)) {
      this.filterParamControlSources = params.filterParamControlSources;
    }
    if (!R.isNil(params.filterParams)) {
      this.setFilterParams(params.filterParams);
    }
    if (!R.isNil(params.masterGain)) {
      this.masterGain = params.masterGain;
    }
  }

  public shutdown() {
    if (!this.awpHandle) {
      console.error('Tried to shut down FM synth before AWP initialized');
      return;
    }

    this.awpHandle.port.postMessage({ type: 'shutdown' });
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
      wavetableState: serializeWavetableState(this.wavetableState),
      gainEnvelope: {
        ...this.gainEnvelope,
        audioThreadData: R.omit(['buffer'], this.gainEnvelope.audioThreadData),
      },
      filterEnvelope: {
        ...this.filterEnvelope,
        audioThreadData: R.omit(['buffer'], this.filterEnvelope.audioThreadData),
      },
      sampleMappingState: serializeSampleMappingState(get(this.sampleMappingStore)),
      useLegacyWavetableControls: this.useLegacyWavetableControls,
      filterParamControlSources: this.filterParamControlSources,
      masterGain: this.masterGain,
    };
  }

  public setFrequencyMultiplier(frequencyMultiplier: number) {
    if (!this.awpHandle) {
      console.warn('Tried to set FM synth frequency multiplier before AWP initialized');
      return;
    }

    this.awpHandle.port.postMessage({ type: 'setFrequencyMultiplier', frequencyMultiplier });
  }

  public handleDetuneChange(newDetune: ParamSource | null) {
    this.detune = R.clone(newDetune);
    if (!this.awpHandle) {
      console.warn('Tried to set FM synth detune before AWP initialized');
      return;
    }

    this.awpHandle.port.postMessage({ type: 'setDetune', ...encodeParamSource(newDetune) });
  }

  private fetchAndSetSample = async (descriptor: SampleDescriptor) => {
    this.fetchedSampleDescriptorHashes.add(hashSampleDescriptor(descriptor));

    try {
      const loadedSample = await getSample(descriptor);
      const data = loadedSample.getChannelData(0);
      this.awpHandle!.port.postMessage({ type: 'setSample', descriptor, data });
      // Re-initialize sample mapping state so that this newly loaded sample is picked up
      this.handleSampleMappingStateChange(get(this.sampleMappingStore));
    } catch (err) {
      console.error('Error loading sample: ', { descriptor, err });
    }
  };

  public handleSampleMappingStateChange = (sampleMappingState: SampleMappingState) => {
    if (!this.awpHandle) {
      console.warn('Tried to set sample mapping state before AWP initialized');
      return;
    }

    this.awpHandle.port.postMessage({ type: 'setSampleMappingState', sampleMappingState });

    // This function will be called after AWP initialization, so don't worry about this yet.  Technically we delay
    // loading samples needlessly a bit and could optimize that if we want
    if (!this.awpHandle) {
      return;
    }

    for (const opState of Object.values(sampleMappingState.stateByOperatorIx)) {
      for (const mappedSamples of Object.values(opState.mappedSamplesByMIDINumber)) {
        mappedSamples.forEach(data => {
          if (!data.descriptor) {
            return;
          }

          const descriptorHash = hashSampleDescriptor(data.descriptor);
          const isFetched = this.fetchedSampleDescriptorHashes.has(descriptorHash);
          if (isFetched) {
            return;
          }

          this.fetchAndSetSample(data.descriptor);
        });
      }
    }
  };

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
            : new DummyNode('fm-synth-frequency'),
        })
        .set('param_0', {
          type: 'number',
          node: this.awpHandle
            ? (this.awpHandle.parameters as any).get('0')
            : new DummyNode('fm-synth-param-0'),
        }),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        type: 'customAudio',
        node: this.awpHandle ? this.awpHandle : new DummyNode('fm-synth-output'),
      }),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
