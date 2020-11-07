import * as R from 'ramda';
import { buildModule, buildActionGroup } from 'jantix';
import { Option } from 'funfix-core';
import { UnimplementedError } from 'ameo-utils';

import { EffectNode } from 'src/synthDesigner/effects';
import { ADSRValues, defaultAdsrEnvelope, ControlPanelADSR } from 'src/controls/adsr';
import { ADSRModule } from 'src/synthDesigner/ADSRModule';
import { SynthPresetEntry, SynthVoicePreset } from 'src/redux/modules/presets';
import WaveTable, {
  decodeWavetableDef,
  getDefaultWavetableDef,
  getWavetableWasmInstance,
} from 'src/graphEditor/nodes/CustomAudio/WaveTable/WaveTable';
import { base64ArrayBuffer } from 'src/util';
import { get_synth_designer_audio_connectables } from 'src/synthDesigner';
import { updateConnectables } from 'src/patchNetwork';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';

const disposeSynthModule = (synthModule: SynthModule) => {
  synthModule.voices.forEach(voice => {
    voice.outerGainNode.disconnect();
    if (voice.wavetable) {
      voice.wavetable.shutdown();
    }
  });
};

export enum Waveform {
  Sine = 'sine',
  Square = 'square',
  Sawtooth = 'sawtooth',
  Triangle = 'triangle',
  Wavetable = 'wavetable',
}

export enum EffectType {
  Bitcrusher = 'bitcrusher',
  Distortion = 'distortion',
  Reverb = 'reverb',
}

export interface Effect {
  type: EffectType;
  node: EffectNode;
}

export interface EffectModule {
  effect: Effect;
  params: { [key: string]: number };
  // If true, then the input will be passed through this effect unchanged.
  isBypassed: boolean;
  // A number from 0 to 1 that represents what percentage of the output will be from the effect and
  // what percentage will be from the input passed through unchanged.
  wetness: number;
  effectGainNode: GainNode;
  passthroughGainNode: GainNode;
}

export enum FilterType {
  Lowpass = 'lowpass',
  Highpass = 'highpass',
  Bandpass = 'bandpass',
  Lowshelf = 'lowshelf',
  Highshelf = 'highshelf',
  Peaking = 'peaking',
  Notch = 'notch',
  Allpass = 'allpass',
}

export interface FilterParams {
  type: FilterType;
  frequency: number;
  Q?: number;
  gain: number;
  detune: number;
}

export interface FilterCSNs {
  frequency: ConstantSourceNode;
  Q: ConstantSourceNode;
  gain: ConstantSourceNode;
  detune: ConstantSourceNode;
}

export interface Voice {
  oscillators: OscillatorNode[];
  wavetable: WaveTable | null;
  effects: EffectModule[];
  // The node that is connected to whatever the synth module as a whole is connected to.  Its
  // source is either the end of the effects chain or the inner gain node.
  outerGainNode: GainNode;
  filterNode: BiquadFilterNode;
  gainADSRModule: ADSRModule;
  filterADSRModule: ADSRModule;
}

export interface SynthModule {
  waveform: Waveform;
  detune: number;
  detuneCSN: ConstantSourceNode;
  voices: Voice[];
  wavetableConf: WavetableConfig | null;
  wavetableInputControls: {
    intraDimMixes: OverridableAudioParam[];
    interDimMixes: OverridableAudioParam[];
  } | null;
  filterParams: FilterParams;
  filterCSNs: FilterCSNs;
  masterGain: number;
  masterGainCSN: ConstantSourceNode;
  selectedEffectType: EffectType;
  gainEnvelope: ADSRValues;
  gainADSRLength: number;
  filterEnvelope: ADSRValues;
  filterADSRLength: number;
  pitchMultiplier: number;
}

const ctx = new AudioContext();

const VOICE_COUNT = 16 as const;

const filterSettings = {
  type: {
    type: 'select',
    label: 'type',
    options: Object.values(FilterType),
    initial: FilterType.Lowpass,
  },
  detune: {
    type: 'range',
    label: 'detune',
    min: -200,
    max: 200,
    initial: 0,
    stepSize: 5,
  },
  frequency: {
    type: 'range',
    label: 'frequency',
    min: 80,
    max: 24000,
    initial: 4400,
    scale: 'log',
    steps: 250,
  },
  gain: {
    type: 'range',
    label: 'gain',
    min: -20,
    max: 40,
    step: 0.2,
    initial: 0,
  },
  q: {
    type: 'range',
    label: 'Q',
    min: 0.001,
    max: 100,
    initial: 0.001,
    steps: 100,
    scale: 'log',
  },
  adsr: {
    type: 'custom',
    label: 'adsr',
    initial: defaultAdsrEnvelope,
    Comp: ControlPanelADSR,
  },
};

export const getSettingsForFilterType = (filterType: FilterType) => [
  filterSettings.type,
  filterSettings.frequency,
  filterSettings.detune,
  ...{
    [FilterType.Lowpass]: [filterSettings.q],
    [FilterType.Highpass]: [filterSettings.q],
    [FilterType.Bandpass]: [filterSettings.q],
    [FilterType.Lowshelf]: [filterSettings.gain],
    [FilterType.Highshelf]: [filterSettings.gain],
    [FilterType.Peaking]: [filterSettings.gain, filterSettings.q],
    [FilterType.Notch]: [filterSettings.q],
    [FilterType.Allpass]: [filterSettings.q],
  }[filterType],
  filterSettings.adsr,
];

export const getDefaultFilterParams = (filterType: FilterType): FilterParams =>
  getSettingsForFilterType(filterType).reduce(
    (acc, { label, initial }) => ({ ...acc, [label]: initial }),
    {}
  ) as FilterParams;

function updateFilterNode<K extends keyof FilterParams>(
  nodes: BiquadFilterNode[],
  csns: FilterCSNs,
  key: K,
  val: FilterParams[K]
) {
  switch (key) {
    case 'type': {
      nodes.forEach(node => {
        node.type = val as FilterType;
      });
      break;
    }
    case 'adsr': {
      break;
    }
    default: {
      const param: ConstantSourceNode = csns[key as Exclude<typeof key, 'type'>];
      param.offset.setValueAtTime(val as number, ctx.currentTime);
    }
  }
}

const packWavetableDefs = (
  wavetableDefs: Float32Array[][]
): {
  dimensionCount: number;
  waveformsPerDimension: number;
  samplesPerWaveform: number;
  packed: Float32Array;
} => {
  const totalSize = wavetableDefs.reduce(
    (acc, dim) => dim.reduce((acc, waveform) => acc + waveform.length, acc),
    0
  );
  const packed = new Float32Array(totalSize);

  let totalSet = 0;
  wavetableDefs.forEach(dim =>
    dim.forEach(waveform => {
      packed.set(waveform, totalSet);
      totalSet += waveform.length;
    })
  );

  return {
    dimensionCount: wavetableDefs.length,
    waveformsPerDimension: wavetableDefs[0].length,
    samplesPerWaveform: wavetableDefs[0][0].length,
    packed,
  };
};

export const serializeSynthModule = (synth: SynthModule) => ({
  unison: synth.voices[0].oscillators.length,
  wavetableConfig: Option.of(synth.wavetableConf?.wavetableDef)
    .map(
      (wavetableDefs): Omit<WavetableConfig, 'onInitialized'> => {
        const {
          dimensionCount,
          waveformsPerDimension,
          samplesPerWaveform,
          packed,
        } = packWavetableDefs(wavetableDefs);

        const encodedWavetableDef = base64ArrayBuffer(packed.buffer);

        return {
          encodedWavetableDef,
          dimensionCount: dimensionCount,
          waveformsPerDimension,
          samplesPerWaveform,
          intraDimMixes: synth.wavetableConf!.intraDimMixes,
          interDimMixes: synth.wavetableConf!.interDimMixes,
        };
      }
    )
    .orNull(),
  waveform: synth.waveform,
  detune: synth.detune,
  filter: synth.filterParams,
  masterGain: synth.masterGain,
  selectedEffectType: synth.selectedEffectType,
  gainEnvelope: synth.gainEnvelope,
  gainADSRLength: synth.gainADSRLength,
  filterEnvelope: synth.filterEnvelope,
  filterADSRLength: synth.filterADSRLength,
  pitchMultiplier: synth.pitchMultiplier,
  type: synth.waveform === Waveform.Wavetable ? ('wavetable' as const) : ('standard' as const),
});

const connectWavetableInputControls = (
  inputControls: NonNullable<SynthModule['wavetableInputControls']>,
  voices: Voice[]
) => {
  inputControls.intraDimMixes.forEach((param, dimIx) => {
    voices.forEach(voice => {
      const voiceParam = voice.wavetable!.paramOverrides[`dimension_${dimIx}_mix`];
      param.outputCSN!.connect(voiceParam.param);
      // Never overridden because we handle that control above the voice level
      voiceParam.param.setIsOverridden(false);
    });
  });
  inputControls.interDimMixes.forEach((param, i) => {
    voices.forEach(voice => {
      const voiceParam = voice.wavetable!.paramOverrides[`dimension_${i}x${i + 1}_mix`];
      param.outputCSN!.connect(voiceParam.param);
      // Never overridden because we handle that control above the voice level
      voiceParam.param.setIsOverridden(false);
    });
  });
};

const buildWavetableInputControls = (
  wavetableConf: WavetableConfig
): NonNullable<SynthModule['wavetableInputControls']> => {
  const inputControls = {
    intraDimMixes: wavetableConf.intraDimMixes.map(mix => {
      const param = new OverridableAudioParam(ctx, undefined, undefined, true);
      param.manualControl.offset.setValueAtTime(0, mix);
      return param;
    }),
    interDimMixes: wavetableConf.interDimMixes.map(mix => {
      const param = new OverridableAudioParam(ctx, undefined, undefined, true);
      param.manualControl.offset.setValueAtTime(0, mix);
      return param;
    }),
  };

  return inputControls;
};

const disconnectWavetableInputControls = (
  inputControls: NonNullable<SynthModule['wavetableInputControls']>
) => {
  inputControls.intraDimMixes.forEach(param => param.dispose());
  inputControls.interDimMixes.forEach(param => param.dispose());
};

export interface SynthDesignerState {
  synths: SynthModule[];
  wavyJonesInstance: AnalyserNode | undefined;
  spectrumNode: AnalyserNode;
  isHidden: boolean;
}

const buildDefaultFilterCSNs = (): FilterCSNs => ({
  frequency: new ConstantSourceNode(ctx),
  Q: new ConstantSourceNode(ctx),
  gain: new ConstantSourceNode(ctx),
  detune: new ConstantSourceNode(ctx),
});

const buildDefaultFilterModule = (
  filterCSNs: FilterCSNs,
  filterADSRModule?: ADSRModule
): {
  filterParams: FilterParams;
  filterNode: BiquadFilterNode;
} => {
  const filterNode = new BiquadFilterNode(ctx);
  const filterParams = getDefaultFilterParams(FilterType.Lowpass);
  filterParams.type = Option.of(filterParams.type).getOrElse(FilterType.Lowpass);
  if (filterADSRModule) {
    filterCSNs.frequency.connect(filterADSRModule.offset);
  }
  filterCSNs.Q.connect(filterNode.Q);
  filterCSNs.gain.connect(filterNode.gain);
  filterCSNs.detune.connect(filterNode.detune);

  Object.entries(filterParams).forEach(([key, val]) =>
    updateFilterNode([filterNode], filterCSNs, key as keyof typeof filterParams, val)
  );

  return { filterParams, filterNode };
};

const buildDefaultSynthModule = (): SynthModule => {
  const filterCSNs = buildDefaultFilterCSNs();
  const { filterParams, filterNode } = buildDefaultFilterModule(filterCSNs);
  filterNode.disconnect();

  const masterGain = 0.0;
  const masterGainCSN = new ConstantSourceNode(ctx);
  masterGainCSN.offset.setValueAtTime(masterGain, ctx.currentTime);
  const inst: SynthModule = {
    waveform: Waveform.Sine,
    detune: 0,
    detuneCSN: new ConstantSourceNode(ctx),
    voices: R.range(0, VOICE_COUNT).map(() => {
      const outerGainNode = new GainNode(ctx);
      outerGainNode.gain.setValueAtTime(0, ctx.currentTime);

      // Start the filter ADSR module and configure it to modulate the voice's filter node's frequency
      const filterADSRModule = new ADSRModule(ctx, {
        minValue: 0,
        maxValue: 10000,
        lengthMs: 2000,
      });
      filterADSRModule.start();

      const { filterNode } = buildDefaultFilterModule(filterCSNs, filterADSRModule);
      filterADSRModule.connect(filterNode.frequency);
      filterNode.connect(outerGainNode);

      const osc = new OscillatorNode(ctx);
      osc.start();
      osc.connect(filterNode);

      // Start the gain ADSR module and configure it to modulate the voice's gain node
      const gainADSRModule = new ADSRModule(ctx, { minValue: 0, maxValue: 1.8, lengthMs: 1000 });
      gainADSRModule.start();
      gainADSRModule.connect(outerGainNode.gain);

      // Connect the mast gain to the ADSR so that we can sum the offsets
      // For whatever reason, you can't connect two CSNs to the same `AudioParam`; it just doesn't seem to work.
      masterGainCSN.connect(gainADSRModule.offset);

      return {
        oscillators: [osc],
        wavetable: null,
        effects: [],
        outerGainNode,
        filterNode,
        gainADSRModule,
        filterADSRModule,
      };
    }),
    wavetableConf: buildDefaultWavetableConfig(),
    filterParams,
    filterCSNs,
    wavetableInputControls: null,
    masterGain,
    masterGainCSN,
    selectedEffectType: EffectType.Reverb,
    gainEnvelope: defaultAdsrEnvelope,
    gainADSRLength: 1000,
    filterEnvelope: defaultAdsrEnvelope,
    filterADSRLength: 1200,
    pitchMultiplier: 1,
  };

  // Connect up + start all the CSNs
  inst.voices.flatMap(R.prop('oscillators')).forEach(osc => inst.detuneCSN.connect(osc.detune));
  inst.detuneCSN.start();
  inst.masterGainCSN.offset.setValueAtTime(masterGain, ctx.currentTime);
  inst.masterGainCSN.start();

  filterCSNs.detune.start();
  filterCSNs.frequency.start();
  filterCSNs.gain.start();
  filterCSNs.Q.start();

  return inst;
};

interface WavetableConfig {
  wavetableDef?: Float32Array[][];
  // This is a Base64-encoded representation of the wavetable's constituent waveforms.  It can be decoded using a Wasm function.
  encodedWavetableDef?: string;
  dimensionCount: number;
  waveformsPerDimension: number;
  samplesPerWaveform: number;
  intraDimMixes: number[];
  interDimMixes: number[];
}

const buildDefaultWavetableConfig = (): WavetableConfig => ({
  dimensionCount: 2,
  waveformsPerDimension: 2,
  samplesPerWaveform: 1470,
  wavetableDef: getDefaultWavetableDef(),
  intraDimMixes: [0, 0],
  interDimMixes: [0],
});

export const deserializeSynthModule = (
  {
    waveform,
    wavetableConfig: baseWavetableConfig,
    unison,
    detune,
    filter: filterParams,
    masterGain,
    selectedEffectType,
    gainEnvelope,
    gainADSRLength,
    filterEnvelope,
    filterADSRLength,
    pitchMultiplier,
  }: {
    waveform: Waveform;
    wavetableConfig: Omit<WavetableConfig, 'onInitialized'> | null;
    unison: number;
    detune: number;
    filter: FilterParams;
    masterGain: number;
    selectedEffectType: EffectType;
    gainEnvelope: ADSRValues;
    gainADSRLength: number;
    filterEnvelope: ADSRValues;
    filterADSRLength: number;
    pitchMultiplier: number;
  },
  dispatch: (action: { type: 'CONNECT_WAVETABLE'; synthIx: number; voiceIx: number }) => void,
  synthIx: number
): SynthModule => {
  const base = buildDefaultSynthModule();
  const wavetableConf = {
    ...buildDefaultWavetableConfig(),
    ...baseWavetableConfig,
  };

  const voices = base.voices.map((voice, voiceIx) => {
    voice.oscillators.forEach(osc => {
      osc.stop();
      osc.disconnect();
    });

    voice.filterNode.connect(voice.outerGainNode);
    Object.entries(filterParams).forEach(([key, val]: [keyof typeof filterParams, any]) =>
      updateFilterNode([voice.filterNode], base.filterCSNs, key, val)
    );

    // TODO: the envelope should probably eventually be set via CSN...
    voice.gainADSRModule.setEnvelope(gainEnvelope);
    voice.gainADSRModule.setLengthMs(gainADSRLength);

    voice.filterADSRModule.setEnvelope(filterEnvelope);
    voice.filterADSRModule.setLengthMs(filterADSRLength);
    voice.filterADSRModule.connect(voice.filterNode.frequency);

    return {
      ...voice,
      oscillators: R.range(0, unison).map(() => {
        const osc = new OscillatorNode(ctx);
        osc.type = waveform === Waveform.Wavetable ? Waveform.Sine : waveform;
        osc.detune.setValueAtTime(0, ctx.currentTime);
        base.detuneCSN.connect(osc.detune);
        osc.start();
        osc.connect(voice.filterNode);
        return osc;
      }),
      wavetable:
        waveform === Waveform.Wavetable
          ? new WaveTable(ctx, '', {
              ...wavetableConf,
              onInitialized: () => dispatch({ type: 'CONNECT_WAVETABLE', synthIx, voiceIx }),
              frequency: 0,
              detune: 0,
            })
          : null,
      effects: [], // TODO
    };
  });

  base.masterGainCSN.offset.setValueAtTime(masterGain, ctx.currentTime);

  if (baseWavetableConfig?.encodedWavetableDef) {
    wavetableConf.wavetableDef = decodeWavetableDef(baseWavetableConfig as any);
    base.wavetableInputControls = buildWavetableInputControls(wavetableConf);
  }

  return {
    ...base,
    waveform,
    detune,
    voices,
    wavetableConf,
    masterGain,
    selectedEffectType,
    gainEnvelope,
    gainADSRLength,
    filterEnvelope,
    filterADSRLength,
    filterParams,
    pitchMultiplier,
  };
};

export const getInitialSynthDesignerState = (addInitialSynth?: boolean): SynthDesignerState => ({
  synths: addInitialSynth ? [buildDefaultSynthModule()] : [],
  wavyJonesInstance: undefined,
  spectrumNode: new AnalyserNode(new AudioContext()),
  isHidden: false,
});

const getSynth = (index: number, synths: SynthDesignerState['synths']) => {
  const targetSynth = synths[index];
  if (!targetSynth) {
    throw new Error(
      `Tried to access synth index ${index} but it isn't set; only ${synths.length} synths exist`
    );
  }

  return targetSynth;
};

const getEffect = (synthIx: number, effectIx: number, synths: SynthDesignerState['synths']) => {
  const targetSynth = getSynth(synthIx, synths);
  const targetEffect = targetSynth.voices.map(({ effects }) => effects[effectIx]);
  if (!targetEffect) {
    throw new Error(
      `Tried to access effect index ${effectIx} on synth index ${synthIx} but it isn't set; only ${targetSynth.voices[0].effects.length} effects exist`
    );
  }

  return { targetSynth, targetEffect };
};

const setSynth = (
  synthIx: number,
  synth: SynthModule,
  state: SynthDesignerState
): SynthDesignerState => ({
  ...state,
  synths: R.set(R.lensIndex(synthIx), synth, state.synths),
});

const setEffect = (
  synthIx: number,
  effectIx: number,
  effect: EffectModule[],
  state: SynthDesignerState
): SynthDesignerState => {
  const targetSynth = getSynth(synthIx, state.synths);
  const newSynth = {
    ...targetSynth,
    voices: targetSynth.voices.map((voice, i) => ({
      ...voice,
      effects: R.set(R.lensIndex(effectIx), effect[i], voice.effects),
    })),
  };
  return setSynth(synthIx, newSynth, state);
};

const mkSetFreqForOsc = (frequency: number, offset?: number) => (osc: OscillatorNode) =>
  osc.frequency.setValueAtTime(
    frequency,
    Option.of(offset)
      .map(offset => ctx.currentTime + offset)
      .getOrElse(ctx.currentTime)
  );

const actionGroups = {
  SET_STATE: buildActionGroup({
    actionCreator: (state: SynthDesignerState) => ({ type: 'SET_STATE', state }),
    subReducer: (_state: SynthDesignerState, { state }) => state,
  }),
  SET_WAVEFORM: buildActionGroup({
    actionCreator: (
      index: number,
      waveform: Waveform,
      dispatch: (action: { type: 'CONNECT_WAVETABLE'; synthIx: number; voiceIx: number }) => void,
      vcId: string
    ) => ({
      type: 'SET_WAVEFORM',
      index,
      waveform,
      dispatch,
      vcId,
    }),
    subReducer: (
      state: SynthDesignerState,
      { index, waveform, dispatch, vcId }
    ): SynthDesignerState => {
      // We need to make sure this is loaded for later when we save
      getWavetableWasmInstance();

      const targetSynth = getSynth(index, state.synths);

      if (targetSynth.waveform === waveform) {
        return state;
      }

      let needsConnectablesUpdate = false;
      if (waveform === Waveform.Wavetable) {
        if (!targetSynth.wavetableConf) {
          targetSynth.wavetableConf = buildDefaultWavetableConfig();
        }
        targetSynth.wavetableInputControls = buildWavetableInputControls(
          targetSynth.wavetableConf!
        );

        // We're switching from a normal oscillator to a wavetable.  If we never had one before, we have to lazy-init one
        targetSynth.voices.forEach((voice, voiceIx) => {
          voice.oscillators.forEach(osc => {
            try {
              osc.disconnect();
            } catch (err) {
              console.error('Error disconnecting oscillator and filter: ', err);
            }
          });

          if (!voice.wavetable) {
            voice.wavetable = new WaveTable(
              ctx,
              '',
              {
                ...targetSynth.wavetableConf,
                onInitialized: () =>
                  dispatch({ type: 'CONNECT_WAVETABLE', synthIx: index, voiceIx }),
                frequency: 0,
              }!
            );
          } else {
            setTimeout(() => dispatch({ type: 'CONNECT_WAVETABLE', synthIx: index, voiceIx }));
          }
        });

        return R.set(R.lensPath(['synths', index, 'waveform']), waveform, state);
      } else if (targetSynth.waveform === Waveform.Wavetable) {
        disconnectWavetableInputControls(targetSynth.wavetableInputControls!);
        targetSynth.wavetableInputControls = null;

        targetSynth.voices.forEach(voice => {
          voice.oscillators.forEach(osc => {
            try {
              osc.connect(voice.filterNode);
            } catch (err) {
              console.error('Error connecting oscillator and filter: ', err);
            }
          });

          const workletHandle = voice.wavetable!.workletHandle;
          if (!workletHandle) {
            // I guess they weren't initialized yet...
            console.warn('`workletHandle` not initialized yet');
            return R.set(R.lensPath(['synths', index, 'waveform']), waveform, state);
          }

          try {
            workletHandle.disconnect();
          } catch (err) {
            console.error('Error disconnecting wavetable worklet from filter: ', err);
          }
        });
      } else {
        needsConnectablesUpdate = false;
      }

      if (needsConnectablesUpdate) {
        const newConnectables = get_synth_designer_audio_connectables(`synthDesigner_${vcId}`);
        updateConnectables(vcId, newConnectables);
      }

      targetSynth.voices.flatMap(R.prop('oscillators')).forEach(osc => (osc.type = waveform));
      return R.set(R.lensPath(['synths', index, 'waveform']), waveform, state);
    },
  }),
  ADD_SYNTH_MODULE: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_SYNTH_MODULE' }),
    subReducer: (state: SynthDesignerState) => {
      const newModule = buildDefaultSynthModule();
      if (state.wavyJonesInstance) {
        newModule.voices
          .map(R.prop('outerGainNode'))
          .forEach(outerGainNode => outerGainNode.connect(state.wavyJonesInstance!));
      }

      return {
        ...state,
        synths: [...state.synths, newModule],
      };
    },
  }),
  DELETE_SYNTH_MODULE: buildActionGroup({
    actionCreator: (index: number) => ({ type: 'DELETE_SYNTH_MODULE', index }),
    subReducer: (state: SynthDesignerState, { index }) => {
      const removedModule = state.synths[index];
      if (!removedModule) {
        console.error(`Tried to remove synth ix ${index} but we only have ${state.synths.length}`);
        return state;
      }

      disposeSynthModule(removedModule);

      return {
        ...state,
        synths: R.remove(index, 1, state.synths),
      };
    },
  }),
  ADD_EFFECT: buildActionGroup({
    actionCreator: (synthIx: number, effect: Effect, params: { [key: string]: number }) => ({
      type: 'ADD_EFFECT',
      synthIx,
      effect,
      params,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, effect, params }) => {
      const targetSynth = getSynth(synthIx, state.synths);

      const effectModules: EffectModule[] = targetSynth.voices.map(voice => {
        const synthOutput = Option.of(R.last(voice.effects))
          .map(R.prop('effect'))
          .map(R.prop('node'))
          .getOrElse(voice.filterNode);

        synthOutput.disconnect();
        synthOutput.connect(effect.node);
        effect.node.connect(voice.outerGainNode);

        const effectGainNode = new GainNode(ctx);
        effectGainNode.gain.setValueAtTime(1, ctx.currentTime);
        const passthroughGainNode = new GainNode(ctx);
        passthroughGainNode.gain.setValueAtTime(0, ctx.currentTime);

        return {
          effect,
          effectGainNode,
          passthroughGainNode,
          wetness: 1,
          isBypassed: false,
          params,
        };
      });

      return setSynth(
        synthIx,
        {
          ...targetSynth,
          voices: targetSynth.voices.map((voice, i) => ({
            ...voice,
            effects: [...voice.effects, effectModules[i]],
          })),
        },
        state
      );
    },
  }),
  REMOVE_EFFECT: buildActionGroup({
    actionCreator: (synthIx: number, effectIndex: number) => ({
      type: 'REMOVE_EFFECT',
      synthIx,
      effectIndex,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, effectIndex }) => {
      const targetSynth = getSynth(synthIx, state.synths);

      const newVoices: Voice[] = targetSynth.voices.map(voice => {
        const removedEffect = voice.effects[effectIndex];
        if (!removedEffect) {
          throw new Error(`No effect at index ${synthIx} for synth index ${effectIndex}`);
        }

        removedEffect.effect.node.disconnect();
        const newSrc = Option.of(voice.effects[synthIx - 1])
          .map(R.prop('effect'))
          .map(R.prop('node'))
          .getOrElse(voice.filterNode);
        const newDst = Option.of(voice.effects[effectIndex + 1])
          .map(R.prop('effect'))
          .map(R.prop('node'))
          .getOrElse(voice.outerGainNode);

        removedEffect.effect.node.disconnect();
        newSrc.disconnect();
        newSrc.connect(newDst);

        return { ...voice, effects: R.remove(effectIndex, 1, voice.effects) };
      });

      return setSynth(synthIx, { ...targetSynth, voices: newVoices }, state);
    },
  }),
  GATE: buildActionGroup({
    actionCreator: (frequency: number, voiceIx: number, synthIx?: number, offset?: number) => ({
      type: 'GATE',
      frequency,
      voiceIx,
      synthIx,
      offset,
    }),
    subReducer: (
      state: SynthDesignerState,
      { frequency: baseFrequency, voiceIx, synthIx, offset }
    ) => {
      // TODO: Dedup
      if (R.isNil(synthIx)) {
        state.synths.forEach(synth => {
          const frequency = baseFrequency * synth.pitchMultiplier;
          const setFreqForOsc = mkSetFreqForOsc(frequency, offset);
          const targetVoice = synth.voices[voiceIx];

          // Trigger gain and filter ADSRs
          targetVoice.gainADSRModule.gate(offset);
          targetVoice.filterADSRModule.gate(offset);

          if (synth.waveform === Waveform.Wavetable && targetVoice.wavetable) {
            targetVoice.wavetable.paramOverrides.frequency.override.offset.setValueAtTime(
              frequency,
              Option.of(offset)
                .map(offset => ctx.currentTime + offset)
                .getOrElse(ctx.currentTime)
            );
          } else {
            targetVoice.oscillators.forEach(osc => setFreqForOsc(osc));
          }
        });
      } else {
        const targetSynth = getSynth(synthIx, state.synths);
        const targetVoice = targetSynth.voices[voiceIx];
        const frequency = baseFrequency * targetSynth.pitchMultiplier;
        const setFreqForOsc = mkSetFreqForOsc(frequency, offset);

        // Trigger gain and filter ADSRs
        targetVoice.gainADSRModule.gate(offset);
        targetVoice.filterADSRModule.gate(offset);

        if (targetSynth.waveform === Waveform.Wavetable && targetVoice.wavetable) {
          targetVoice.wavetable.paramOverrides.frequency.override.offset.setValueAtTime(
            frequency,
            Option.of(offset)
              .map(offset => ctx.currentTime + offset)
              .getOrElse(ctx.currentTime)
          );
        } else {
          targetVoice.oscillators.forEach(osc => setFreqForOsc(osc));
        }
      }

      return state;
    },
  }),
  UNGATE: buildActionGroup({
    actionCreator: (voiceIx: number, synthIx?: number, offset?: number) => ({
      type: 'UNGATE',
      voiceIx,
      synthIx,
      offset,
    }),
    subReducer: (state: SynthDesignerState, { voiceIx, synthIx, offset }) => {
      if (R.isNil(synthIx)) {
        state.synths.forEach(({ voices }) => {
          const targetVoice = voices[voiceIx];

          // Trigger release of gain and filter ADSRs
          targetVoice.gainADSRModule.ungate(offset, () => {
            // Setting the frequency to 0 is an optimization that causes the worklet to avoid having to do
            // any processing when the synth is not playing
            targetVoice.wavetable?.paramOverrides.frequency.override.offset.setValueAtTime(
              0,
              Option.of(offset)
                .map(offset => ctx.currentTime + offset)
                .getOrElse(ctx.currentTime)
            );
          });
          targetVoice.filterADSRModule.ungate(offset);
        });
      } else {
        const targetSynth = getSynth(synthIx, state.synths);
        const targetVoice = targetSynth.voices[voiceIx];

        // Trigger release of gain and filter ADSRs
        targetVoice.gainADSRModule.ungate(offset, () => {
          // Setting the frequency to 0 is an optimization that causes the worklet to avoid having to do
          // any processing when the synth is not playing
          targetVoice.wavetable?.paramOverrides.frequency.override.offset.setValueAtTime(
            0,
            Option.of(offset)
              .map(offset => ctx.currentTime + offset)
              .getOrElse(ctx.currentTime)
          );
        });
        targetVoice.filterADSRModule.ungate(offset);
      }

      return state;
    },
  }),
  SET_UNISON: buildActionGroup({
    actionCreator: (synthIx: number, unison: number) => ({ type: 'SET_UNISON', synthIx, unison }),
    subReducer: (state: SynthDesignerState, { synthIx, unison }) => {
      const targetSynth = getSynth(synthIx, state.synths);

      if (unison <= 0 || parseInt(unison.toString(), 10) !== unison) {
        console.error(`Invalid unison value of ${unison} provided`);
        return state;
      }

      const newVoices = targetSynth.voices.map(voice => {
        while (voice.oscillators.length > unison) {
          const osc = voice.oscillators.pop()!;
          osc.stop();
          osc.disconnect();
        }

        while (voice.oscillators.length < unison) {
          const osc = new OscillatorNode(ctx);
          // TODO: Set detune and other params here once they are implemented and stored in state
          // TODO: Keep track of playing state for all synths and trigger oscillators if synth is playing
          osc.type =
            targetSynth.waveform === Waveform.Wavetable ? Waveform.Sine : targetSynth.waveform;
          voice.oscillators.push(osc);
          osc.start();
        }

        return { ...voice, oscillators: [...voice.oscillators] };
      });

      return {
        ...state,
        synths: [
          ...state.synths.slice(0, synthIx),
          { ...targetSynth, voices: newVoices },
          ...state.synths.slice(synthIx + 1),
        ],
      };
    },
  }),
  SET_DETUNE: buildActionGroup({
    actionCreator: (detune: number, synthIx?: number) => ({ type: 'SET_DETUNE', synthIx, detune }),
    subReducer: (state: SynthDesignerState, { synthIx, detune }) => {
      if (R.isNil(synthIx)) {
        return {
          ...state,
          synths: state.synths.map(synth => {
            synth.detuneCSN.offset.setValueAtTime(detune, ctx.currentTime);

            return { ...synth, detune };
          }),
        };
      }

      const targetSynth = getSynth(synthIx, state.synths);
      targetSynth.detuneCSN.offset.setValueAtTime(detune, ctx.currentTime);

      return setSynth(synthIx, { ...targetSynth, detune }, state);
    },
  }),
  SET_GAIN_ADSR: buildActionGroup({
    actionCreator: (envelope: ADSRValues, synthIx: number) => ({
      type: 'SET_GAIN_ADSR',
      envelope,
      synthIx,
    }),
    subReducer: (state: SynthDesignerState, { envelope, synthIx }) => {
      const targetSynth = getSynth(synthIx, state.synths);
      targetSynth.voices.forEach(voice => voice.gainADSRModule.setEnvelope(envelope));

      return setSynth(synthIx, { ...targetSynth, gainEnvelope: envelope }, state);
    },
  }),
  SET_GAIN_ADSR_LENGTH: buildActionGroup({
    actionCreator: (length: number, synthIx: number) => ({
      type: 'SET_GAIN_ADSR_LENGTH',
      length,
      synthIx,
    }),
    subReducer: (state: SynthDesignerState, { length, synthIx }) => {
      const targetSynth = getSynth(synthIx, state.synths);
      targetSynth.voices.forEach(voice => voice.gainADSRModule.setLengthMs(length));
      return setSynth(synthIx, { ...targetSynth, gainADSRLength: length }, state);
    },
  }),
  SET_FILTER_ADSR: buildActionGroup({
    actionCreator: (envelope: ADSRValues, synthIx: number) => ({
      type: 'SET_FILTER_ADSR',
      envelope,
      synthIx,
    }),
    subReducer: (state: SynthDesignerState, { envelope, synthIx }) => {
      const targetSynth = getSynth(synthIx, state.synths);
      targetSynth.voices.forEach(voice => voice.filterADSRModule.setEnvelope(envelope));

      return setSynth(synthIx, { ...targetSynth, filterEnvelope: envelope }, state);
    },
  }),
  SET_FILTER_ADSR_LENGTH: buildActionGroup({
    actionCreator: (length: number, synthIx: number) => ({
      type: 'SET_FILTER_ADSR_LENGTH',
      length,
      synthIx,
    }),
    subReducer: (state: SynthDesignerState, { length, synthIx }) => {
      const targetSynth = getSynth(synthIx, state.synths);
      targetSynth.voices.forEach(voice => voice.filterADSRModule.setLengthMs(length));
      return setSynth(synthIx, { ...targetSynth, filterADSRLength: length }, state);
    },
  }),
  SET_WAVY_JONES_INSTANCE: buildActionGroup({
    actionCreator: (instance: AnalyserNode) => ({ type: 'SET_WAVY_JONES_INSTANCE', instance }),
    subReducer: (state: SynthDesignerState, { instance }) => {
      state.synths
        .flatMap(R.prop('voices'))
        .forEach(({ outerGainNode }) => outerGainNode.connect(instance));

      if (state.spectrumNode) {
        instance.connect(state.spectrumNode);
      }

      return { ...state, wavyJonesInstance: instance };
    },
  }),
  SET_EFFECT_BYPASSED: buildActionGroup({
    actionCreator: (synthIx: number, effectIx: number, isBypassed = true) => ({
      type: 'SET_EFFECT_BYPASSED' as const,
      isBypassed,
      synthIx,
      effectIx,
    }),
    subReducer: (
      state: SynthDesignerState,
      {
        isBypassed,
        synthIx,
        effectIx,
      }: { type: 'SET_EFFECT_BYPASSED'; isBypassed: boolean; synthIx: number; effectIx: number }
    ): SynthDesignerState => {
      const { targetEffect } = getEffect(synthIx, effectIx, state.synths);
      // TODO: Actually bypass?
      return setEffect(
        synthIx,
        effectIx,
        targetEffect.map(targetEffect => ({ ...targetEffect, isBypassed })),
        state
      );
    },
  }),
  SET_EFFECT_WETNESS: buildActionGroup({
    actionCreator: (synthIx: number, effectIx: number, wetness: number) => ({
      type: 'SET_EFFECT_WETNESS',
      synthIx,
      effectIx,
      wetness,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, effectIx, wetness }) => {
      const { targetEffect } = getEffect(synthIx, effectIx, state.synths);
      if (wetness < 0 || wetness > 1) {
        console.error(`Invalid wetness of ${wetness} provided`);
        return state;
      }

      // TODO: Use a CSN for effects?
      const newEffects = targetEffect.map(targetEffect => {
        targetEffect.effectGainNode.gain.setValueAtTime(wetness, ctx.currentTime);
        targetEffect.passthroughGainNode.gain.setValueAtTime(1 - wetness, ctx.currentTime);

        return { ...targetEffect, wetness };
      });

      return setEffect(synthIx, effectIx, newEffects, state);
    },
  }),
  SET_EFFECT_PARAM: buildActionGroup({
    actionCreator: (synthIx: number, effectIx: number, key: string, val: number) => ({
      type: 'SET_EFFECT_PARAM',
      synthIx,
      effectIx,
      key,
      val,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, effectIx, key, val }) => {
      const { targetEffect } = getEffect(synthIx, effectIx, state.synths);
      targetEffect.forEach(targetEffect => targetEffect.effect.node.setParam(key, val));

      return setEffect(
        synthIx,
        effectIx,
        targetEffect.map(targetEffect => ({
          ...targetEffect,
          params: { ...targetEffect.params, [key]: val },
        })),
        state
      );
    },
  }),
  SET_FILTER_PARAM: buildActionGroup({
    actionCreator<K extends keyof FilterParams>(synthIx: number, key: K, val: FilterParams[K]) {
      return { type: 'SET_FILTER_PARAM', synthIx, key, val };
    },
    subReducer: (state: SynthDesignerState, { synthIx, key, val }) => {
      const targetSynth = getSynth(synthIx, state.synths);

      updateFilterNode(
        targetSynth.voices.map(R.prop('filterNode')),
        targetSynth.filterCSNs,
        key as keyof FilterParams,
        val
      );

      const newSynth = {
        ...targetSynth,
        filterParams: { ...targetSynth.filterParams, ...targetSynth.filterParams, [key]: val },
      };
      return setSynth(synthIx, newSynth, state);
    },
  }),
  SET_SYNTH_MASTER_GAIN: buildActionGroup({
    actionCreator: (synthIx: number, gain: number) => ({
      type: 'SET_SYNTH_MASTER_GAIN',
      synthIx,
      gain,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, gain }) => {
      const targetSynth = getSynth(synthIx, state.synths);
      targetSynth.masterGainCSN.offset.setValueAtTime(gain, ctx.currentTime);
      return setSynth(synthIx, { ...targetSynth, masterGain: gain }, state);
    },
  }),
  SET_SELECTED_EFFECT_TYPE: buildActionGroup({
    actionCreator: (synthIx: number, effectType: EffectType) => ({
      type: 'SET_SELECTED_EFFECT_TYPE',
      synthIx,
      effectType,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, effectType }) => {
      const targetSynth = getSynth(synthIx, state.synths);
      return setSynth(synthIx, { ...targetSynth, selectedEffectType: effectType }, state);
    },
  }),
  CLEAR_ALL_SCHEDULED_MIDI_EVENTS: buildActionGroup({
    actionCreator: (stopPlayingNotes: boolean) => ({
      type: 'CLEAR_ALL_SCHEDULED_MIDI_EVENTS',
      stopPlayingNotes,
    }),
    subReducer: (state: SynthDesignerState, { stopPlayingNotes }) => {
      state.synths.forEach(synth =>
        synth.voices.forEach(voice => {
          voice.gainADSRModule.offset.cancelScheduledValues(0);
          voice.filterADSRModule.offset.cancelScheduledValues(0);

          if (stopPlayingNotes) {
            voice.gainADSRModule.offset.linearRampToValueAtTime(
              voice.gainADSRModule.minValue,
              ctx.currentTime + 1.5 / 1000
            );
            voice.filterADSRModule.offset.linearRampToValueAtTime(
              voice.filterADSRModule.minValue,
              ctx.currentTime + 1.5 / 1000
            );
          }

          voice.oscillators.forEach(osc => osc.frequency.cancelScheduledValues(0));
        })
      );

      return state;
    },
  }),
  SET_VOICE_STATE: buildActionGroup({
    actionCreator: (
      synthIx: number,
      preset: SynthVoicePreset | null,
      dispatch: (action: { type: 'CONNECT_WAVETABLE'; synthIx: number; voiceIx: number }) => void
    ) => ({
      type: 'SET_VOICE_STATE',
      synthIx,
      preset,
      dispatch,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, preset, dispatch }) => {
      if (preset && preset.type !== 'standard') {
        throw new UnimplementedError();
      }

      synthIx = synthIx === -1 ? state.synths.length - 1 : synthIx;
      const oldSynthModule = state.synths[synthIx];
      if (!oldSynthModule) {
        console.error(
          `Tried to replace synth index ${synthIx} but only ${state.synths.length} exist`
        );
        return state;
      }
      disposeSynthModule(oldSynthModule);

      const builtVoice: SynthModule = preset
        ? deserializeSynthModule(preset, dispatch, synthIx)
        : buildDefaultSynthModule();
      if (state.wavyJonesInstance) {
        builtVoice.voices
          .map(R.prop('outerGainNode'))
          .forEach(outerGainNode => outerGainNode.connect(state.wavyJonesInstance!));
      }

      // TODO: Probably have to disconnect/dispose the old voice...
      return { ...state, synths: R.set(R.lensIndex(synthIx), builtVoice, state.synths) };
    },
  }),
  SET_SYNTH_DESIGNER_IS_HIDDEN: buildActionGroup({
    actionCreator: (isHidden: boolean) => ({ type: 'SET_SYNTH_DESIGNER_IS_HIDDEN', isHidden }),
    subReducer: (state: SynthDesignerState, { isHidden }) => ({ ...state, isHidden }),
  }),
  CONNECT_WAVETABLE: buildActionGroup({
    actionCreator: (synthIx: number, voiceIx: number) => ({
      type: 'CONNECT_WAVETABLE',
      synthIx,
      voiceIx,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, voiceIx }) => {
      // WaveTable initialization can be async, so we need to asynchronously re-connect it once it's been initialized
      const targetSynth = state.synths[synthIx];
      if (targetSynth.waveform !== Waveform.Wavetable) {
        // Maybe user switched off of wavetable before we finished initializing.  In any case, we'll properly re-connect if
        // the user switches back, so nothing to do here
        return state;
      }

      // Connect the master wavetable control inputs to this newly initialized voice
      const targetVoice = targetSynth.voices[voiceIx];
      connectWavetableInputControls(targetSynth.wavetableInputControls!, [targetVoice]);

      if (!targetVoice.wavetable) {
        console.warn('No `wavetable` but waveform was `wavetable`');
        return state;
      } else if (!targetVoice.wavetable.workletHandle) {
        console.error('No `workletHandle` but wavetable said it was initialized');
        return state;
      }

      targetVoice.oscillators.forEach(osc => {
        try {
          osc.disconnect();
        } catch (err) {
          console.error('Error disconnecting oscillator and filter: ', err);
        }
      });

      targetSynth.detuneCSN.connect(targetVoice.wavetable.paramOverrides.detune.param);

      try {
        targetVoice.wavetable.workletHandle.connect(targetVoice.filterNode);
      } catch (err) {
        console.error('Error connecting wavetable to `filterNode`: ', err);
      }

      return state;
    },
  }),
  SET_WAVETABLE_INTRA_DIM_MIX: buildActionGroup({
    actionCreator: (synthIx: number, dimIx: number, mix: number) => ({
      type: 'SET_WAVETABLE_INTRA_DIM_MIX',
      synthIx,
      dimIx,
      mix,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, dimIx, mix }) => {
      const synth = getSynth(synthIx, state.synths);
      synth.wavetableInputControls!.intraDimMixes[dimIx].manualControl.offset.setValueAtTime(
        mix,
        ctx.currentTime
      );

      return setSynth(
        synthIx,
        R.set(R.lensPath(['wavetableConf', 'intraDimMixes', dimIx]), mix, synth),
        state
      );
    },
  }),
  SET_WAVETABLE_INTER_DIM_MIX: buildActionGroup({
    actionCreator: (synthIx: number, baseDimIx: number, mix: number) => ({
      type: 'SET_WAVETABLE_INTER_DIM_MIX',
      synthIx,
      baseDimIx,
      mix,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, baseDimIx, mix }) => {
      const synth = getSynth(synthIx, state.synths);
      synth.wavetableInputControls!.interDimMixes[baseDimIx].manualControl.offset.setValueAtTime(
        mix,
        ctx.currentTime
      );

      return setSynth(
        synthIx,
        R.set(R.lensPath(['wavetableConf', 'interDimMixes', baseDimIx]), mix, synth),
        state
      );
    },
  }),
  SET_PITCH_MULTIPLIER: buildActionGroup({
    actionCreator: (synthIx: number, pitchMultiplier: number) => ({
      type: 'SET_PITCH_MULTIPLIER',
      synthIx,
      pitchMultiplier,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, pitchMultiplier }) => {
      const synth = getSynth(synthIx, state.synths);
      return setSynth(synthIx, { ...synth, pitchMultiplier }, state);
    },
  }),
  SET_SYNTH_PRESET: buildActionGroup({
    actionCreator: (
      preset: SynthPresetEntry,
      dispatch: (action: { type: 'CONNECT_WAVETABLE'; synthIx: number; voiceIx: number }) => void
    ) => ({ type: 'SET_SYNTH_PRESET', preset, dispatch }),
    subReducer: (state: SynthDesignerState, { preset, dispatch }) => {
      if (state.synths.length !== 0) {
        throw new Error(
          'Expected that all synths would be removed before dispatching `SET_SYNTH_PRESET`'
        );
      }

      const synths = preset.body.voices.map((def, i) => deserializeSynthModule(def, dispatch, i));
      return { ...state, synths };
    },
  }),
};

const SynthDesignerReduxInfra = buildModule<SynthDesignerState, typeof actionGroups>(
  getInitialSynthDesignerState(true),
  actionGroups
);

export default SynthDesignerReduxInfra;
