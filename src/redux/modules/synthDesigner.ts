import { UnreachableException } from 'ameo-utils';
import { buildActionGroup, buildModule, buildStore } from 'jantix';
import * as R from 'ramda';
import type { Root as ReactDOMRoot } from 'react-dom/client';

import { buildDefaultADSR2Envelope, type AudioThreadData } from 'src/controls/adsr2/adsr2';
import FMSynth, {
  AdsrLengthMode,
  type Adsr,
} from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { updateConnectables } from 'src/patchNetwork/interface';
import type { MIDINode } from 'src/patchNetwork/midiNode';
import type { SynthPresetEntry, SynthVoicePreset } from 'src/redux/modules/presets';
import { get_synth_designer_audio_connectables } from 'src/synthDesigner';
import {
  type AbstractFilterModule,
  buildAbstractFilterModule,
  type FilterCSNs,
} from 'src/synthDesigner/biquadFilterModule';
import { FilterType, getDefaultFilterParams } from 'src/synthDesigner/filterHelpers';
import { msToSamples, normalizeEnvelope, samplesToMs } from 'src/util';

export interface FilterParams {
  type: FilterType;
  frequency: number;
  Q?: number;
  gain: number;
  detune: number;
}

export interface Voice {
  // The node that is connected to whatever the synth module as a whole is connected to.  Its
  // source is the inner gain node.
  outerGainNode: GainNode;
  filterNode: AbstractFilterModule;
  lastGateOrUngateTime: number;
}

interface PolysynthContext {
  module: typeof import('src/polysynth');
  ctxPtr: number;
}

export interface SynthModule {
  filterBypassed: boolean;
  filterEnvelopeEnabled?: boolean;
  voices: Voice[];
  fmSynth: FMSynth;
  filterParams: FilterParams;
  /**
   * These are the `OverridableAudioParam`s that are exported from the synth module and can be used to
   * control the filter's params either via UI or patch network.
   *
   * They are not used if filter ADSR is enabled, in which case the ADSR has full control over the
   * filter's frequency.
   */
  filterCSNs: FilterCSNs;
  masterGain: number;
  filterEnvelope: Adsr;
  filterADSRLength: number;
  pitchMultiplier: number;
}

const ctx = new AudioContext();

const VOICE_COUNT = 10 as const;

/**
 * @returns a new array of filters to replace the old ones if new ones had to be created due to the
 * filter type changing, `null` otherwise
 */
function updateFilterNode<K extends keyof FilterParams>(
  filters: AbstractFilterModule[],
  csns: FilterCSNs,
  key: K,
  val: FilterParams[K]
): AbstractFilterModule[] | null {
  switch (key as string) {
    case 'type': {
      filters.forEach(filter => filter.destroy());
      return new Array(filters.length)
        .fill(null)
        .map(() => buildAbstractFilterModule(ctx, val as any, csns));
    }
    case 'adsr':
    case 'bypass':
    case 'enable envelope':
    case 'adsr length ms':
    case 'log scale':
      return null;
    case 'q':
    case 'Q':
      csns.Q.manualControl.offset.value = (val as any) ?? 0;
      return null;
    default: {
      const baseParam = csns[key as Exclude<typeof key, 'type'>];
      if (!baseParam) {
        console.error('`updateFilterNode`: unhandled key: ', key);
        return null;
      }
      const param: ConstantSourceNode = baseParam.manualControl;
      param.offset.value = val as number;
      return null;
    }
  }
}

export const serializeSynthModule = (synth: SynthModule) => ({
  fmSynthConfig: synth.fmSynth.serialize(),
  filter: synth.filterParams,
  masterGain: synth.masterGain,
  filterEnvelope: {
    ...synth.filterEnvelope,
    audioThreadData: R.omit(['buffer'], synth.filterEnvelope.audioThreadData),
  },
  filterADSRLength: synth.filterADSRLength,
  pitchMultiplier: synth.pitchMultiplier,
  filterBypassed: synth.filterBypassed,
  filterEnvelopeEnabled: synth.filterEnvelopeEnabled,
});

/**
 * Connects or disconnects the FM synth output for all voices to either the filter or the voice outer gain
 * node depending on whether the filter is bypassed.
 */
const connectOscillators = (connect: boolean, synth: SynthModule) =>
  synth.voices.forEach((voice, voiceIx) => {
    const voiceDst = synth.filterBypassed ? voice.outerGainNode : voice.filterNode.getInput();

    const fmSynthAWPNode = synth.fmSynth.getAWPNode();
    if (!fmSynthAWPNode) {
      console.error('`connectOscillators`: no fmSynthAWPNode');
      return;
    }

    if (!connect) {
      try {
        fmSynthAWPNode.disconnect();
      } catch (_err) {
        // pass
      }
    } else {
      fmSynthAWPNode.connect(voiceDst, voiceIx);
    }
  });

const connectFilterADSRToFrequencyParams = async (
  voices: Voice[],
  fmSynth: FMSynth,
  filterCSNs: FilterCSNs
) => {
  const awpNode = await fmSynth.onInitialized().then(fmSynth => fmSynth.getAWPNode()!);
  voices.forEach((voice, voiceIx) =>
    voice.filterNode.getFrequencyParams().forEach(frequencyParam => {
      awpNode.connect(frequencyParam, VOICE_COUNT + voiceIx);
      try {
        filterCSNs.frequency.outputCSN?.disconnect(frequencyParam);
      } catch (_err) {
        // pass
      }
    })
  );
};

const disconnectFilterADSRFromFrequencyParams = async (
  voices: Voice[],
  fmSynth: FMSynth,
  filterCSNs: FilterCSNs
) => {
  const awpNode = await fmSynth.onInitialized().then(fmSynth => fmSynth.getAWPNode()!);
  voices.forEach((voice, voiceIx) =>
    voice.filterNode.getFrequencyParams().forEach(frequencyParam => {
      filterCSNs.frequency.outputCSN?.connect(frequencyParam);
      try {
        awpNode.disconnect(frequencyParam, VOICE_COUNT + voiceIx);
      } catch (_err) {
        // pass
      }
    })
  );
};

const disposeSynthModule = (synth: SynthModule) => {
  synth.fmSynth.shutdown();
  synth.voices.forEach(voice => {
    voice.outerGainNode.disconnect();
    voice.filterNode.destroy();
  });
};

const connectFMSynth = (stateKey: string, synthIx: number) => {
  const vcId = stateKey.split('_')[1];
  const reduxInfra = getSynthDesignerReduxInfra(stateKey);
  if (!reduxInfra) {
    console.error('Failed to get synth designer redux infra for vcId=' + vcId);
    return;
  }

  const targetSynth = reduxInfra.getState().synthDesigner.synths[synthIx];
  if (!targetSynth) {
    console.error(
      `Failed to get synth at index=${synthIx} for vcId=${vcId} when connecting FM synth`
    );
    return;
  }

  connectOscillators(false, targetSynth);
  connectOscillators(true, targetSynth);

  const newConnectables = get_synth_designer_audio_connectables(`synthDesigner_${vcId}`);
  updateConnectables(vcId, newConnectables);
};

const mkOnGate =
  (getState: () => { synthDesigner: SynthDesignerState }) =>
  (_midiNumber: number, voiceIx: number) => {
    getState().synthDesigner.synths.forEach(synth => {
      const targetVoice = synth.voices[voiceIx];

      // We edit state directly w/o updating references because this is only needed internally
      targetVoice.lastGateOrUngateTime = ctx.currentTime;
    });
  };

const mkOnUngate =
  (getState: () => { synthDesigner: SynthDesignerState }) =>
  (_midiNumber: number, voiceIx: number) =>
    getState().synthDesigner.synths.forEach(({ voices, fmSynth }, synthIx) => {
      const targetVoice = voices[voiceIx];
      // We edit state directly w/o updating references because this is only needed internally
      const ungateTime = ctx.currentTime;
      targetVoice.lastGateOrUngateTime = ungateTime;
      const releaseLengthMs =
        (1 - fmSynth.gainEnvelope.releasePoint) *
        samplesToMs(fmSynth.gainEnvelope.lenSamples.value);

      setTimeout(
        () => {
          const state = getState().synthDesigner;
          const targetSynth = state.synths[synthIx];
          if (!targetSynth) {
            return;
          }

          // If a different note has started playing, we don't want to perform this
          if (targetSynth.voices[voiceIx].lastGateOrUngateTime !== ungateTime) {
            return;
          }

          targetSynth.fmSynth.clearOutputBuffer(voiceIx);
        },
        // We wait until the voice is done playing, accounting for the early-release phase and
        // adding a little bit extra leeway
        //
        // We will need to make this dynamic if we make the length of the early release period
        // user-configurable
        releaseLengthMs + (2_640 / 44_100) * 1000 + 60
      );
    });

export interface SynthDesignerState {
  synths: SynthModule[];
  wavyJonesInstance: AnalyserNode | undefined;
  spectrumNode: AnalyserNode;
  isHidden: boolean;
  vcId: string;
}

const buildDefaultFilterCSNs = (): FilterCSNs => ({
  frequency: new OverridableAudioParam(ctx),
  Q: new OverridableAudioParam(ctx),
  gain: new OverridableAudioParam(ctx),
  detune: new OverridableAudioParam(ctx),
});

const buildDefaultFilterModule = (
  filterType: FilterType,
  filterCSNs: FilterCSNs
): {
  filterParams: FilterParams;
  filterNode: AbstractFilterModule;
} => {
  const filterNode = buildAbstractFilterModule(ctx, filterType, filterCSNs);
  const filterParams = getDefaultFilterParams(filterType);
  filterParams.type = filterParams.type ?? filterType;

  Object.entries(filterParams)
    .filter(([k, _v]) => k !== 'type')
    .forEach(([key, val]) =>
      updateFilterNode([filterNode], filterCSNs, key as keyof typeof filterParams, val)
    );

  return { filterParams, filterNode };
};

const buildDefaultFilterEnvelope = (audioThreadData: AudioThreadData): Adsr => {
  const envelope = buildDefaultADSR2Envelope(audioThreadData);
  envelope.logScale = true;
  return envelope;
};

const buildDefaultSynthModule = (
  wavyJonesInstance: AnalyserNode | undefined,
  stateKey: string,
  filterType: FilterType,
  synthIx: number,
  filterEnvelope: Adsr,
  filterEnvelopeEnabled: boolean,
  providedFMSynth?: FMSynth
): SynthModule => {
  const filterCSNs = buildDefaultFilterCSNs();
  const filterParams = getDefaultFilterParams(filterType);

  const vcId = stateKey.split('_')[1]!;
  const fmSynth =
    providedFMSynth ??
    new FMSynth(ctx, undefined, {
      filterEnvelope: filterEnvelope ? normalizeEnvelope(filterEnvelope) : filterEnvelope,
      onInitialized: () => {
        const getState = SynthDesignerStateByStateKey.get(stateKey)?.getState;
        if (!getState) {
          throw new Error(`Failed to get state for stateKey=${stateKey}`);
        }
        const pitchMultiplier = getState().synthDesigner.synths[synthIx].pitchMultiplier;
        fmSynth.setFrequencyMultiplier(pitchMultiplier);

        connectFMSynth(stateKey, synthIx);

        fmSynth.registerGateUngateCallbacks(mkOnGate(getState), mkOnUngate(getState));
      },
      audioThreadMIDIEventMailboxID: `${vcId}-fm-synth-${genRandomStringID()}`,
      useLegacyWavetableControls: false,
    });

  const inst: SynthModule = {
    filterBypassed: true,
    voices: new Array(VOICE_COUNT).fill(null).map(() => {
      const outerGainNode = new GainNode(ctx);
      outerGainNode.gain.value = 1;

      const { filterNode } = buildDefaultFilterModule(filterType, filterCSNs);

      filterNode.getOutput().connect(outerGainNode);
      if (wavyJonesInstance) {
        outerGainNode.connect(wavyJonesInstance);
      }

      return {
        outerGainNode,
        filterNode,
        lastGateOrUngateTime: 0,
      };
    }),
    fmSynth,
    filterParams,
    filterCSNs,
    masterGain: 0,
    filterEnvelope: {
      ...buildDefaultFilterEnvelope(filterEnvelope.audioThreadData),
      lengthMode: AdsrLengthMode.Samples,
    },
    filterEnvelopeEnabled,
    filterADSRLength: 1000,
    pitchMultiplier: 1,
  };

  if (inst.filterEnvelopeEnabled) {
    connectFilterADSRToFrequencyParams(inst.voices, inst.fmSynth, inst.filterCSNs);
  } else {
    disconnectFilterADSRFromFrequencyParams(inst.voices, inst.fmSynth, inst.filterCSNs);
  }

  return inst;
};

export const deserializeSynthModule = (
  wavyJonesInstance: AnalyserNode | undefined,
  {
    filter: filterParams,
    masterGain,
    gainEnvelope,
    gainADSRLength,
    filterEnvelope,
    filterADSRLength,
    pitchMultiplier,
    filterBypassed = true,
    fmSynthConfig,
    filterEnvelopeEnabled = false,
  }: SynthVoicePreset,
  stateKey: string,
  synthIx: number
): SynthModule => {
  if (R.isNil(filterEnvelope.lengthMode)) {
    filterEnvelope.lengthMode = AdsrLengthMode.Samples;
  }
  filterEnvelope.logScale = false;

  const vcId = stateKey.split('_')[1]!;
  const fmSynth = new FMSynth(ctx, undefined, {
    ...(fmSynthConfig || {}),
    gainEnvelope: gainEnvelope
      ? { ...normalizeEnvelope(gainEnvelope), lenSamples: msToSamples(gainADSRLength ?? 1000) }
      : fmSynthConfig.gainEnvelope,
    filterEnvelope: filterEnvelope
      ? {
          ...normalizeEnvelope(filterEnvelope),
          lenSamples:
            (filterEnvelope.lengthMode ?? AdsrLengthMode.Samples) === AdsrLengthMode.Samples
              ? msToSamples(filterADSRLength ?? 1000)
              : filterADSRLength ?? 1,
        }
      : fmSynthConfig.filterEnvelope,
    onInitialized: () => {
      fmSynth.setFrequencyMultiplier(pitchMultiplier);

      connectFMSynth(stateKey, synthIx);

      const getState = SynthDesignerStateByStateKey.get(stateKey)?.getState;
      if (!getState) {
        throw new Error(`Failed to get state for stateKey=${stateKey}`);
      }
      fmSynth.registerGateUngateCallbacks(mkOnGate(getState), mkOnUngate(getState));
    },
    audioThreadMIDIEventMailboxID: `${vcId}-fm-synth-${genRandomStringID()}`,
  });

  const base = buildDefaultSynthModule(
    wavyJonesInstance,
    stateKey,
    filterParams.type,
    synthIx,
    filterEnvelope,
    filterEnvelopeEnabled,
    fmSynth
  );

  if ((filterEnvelope as any).attack) {
    filterEnvelope = buildDefaultFilterEnvelope(filterEnvelope.audioThreadData);
  }

  const voices = base.voices.map(voice => {
    voice.outerGainNode.gain.value = masterGain + 1;
    Object.entries(filterParams)
      .filter(([k, _v]) => k !== 'type')
      .forEach(([key, val]: [keyof typeof filterParams, any]) =>
        updateFilterNode([voice.filterNode], base.filterCSNs, key, val)
      );

    return voice;
  });

  const normalizedFilterEnvelope = normalizeEnvelope(filterEnvelope);

  const synthModule = {
    ...base,
    filterBypassed,
    voices,
    masterGain,
    filterEnvelope: normalizedFilterEnvelope,
    filterADSRLength:
      (normalizedFilterEnvelope.lengthMode ?? AdsrLengthMode.Samples) === AdsrLengthMode.Samples
        ? R.clamp(20, 100_000, filterADSRLength ?? 1000)
        : R.clamp(0.001, 100_000, filterADSRLength ?? 1),
    filterParams,
    pitchMultiplier: pitchMultiplier ?? 1,
  };

  return synthModule;
};

export const getInitialSynthDesignerState = (vcId: string): SynthDesignerState => ({
  synths: [
    buildDefaultSynthModule(
      undefined,
      `synthDesigner_${vcId}`,
      FilterType.Lowpass,
      0,
      buildDefaultFilterEnvelope({
        phaseIndex: 254,
        debugName: 'getInitialSynthDesignerState',
      }),
      false
    ),
  ],
  wavyJonesInstance: undefined,
  spectrumNode: new AnalyserNode(new AudioContext()),
  isHidden: false,
  vcId,
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

const setSynth = (
  synthIx: number,
  synth: SynthModule,
  state: SynthDesignerState
): SynthDesignerState => ({
  ...state,
  synths: R.set(R.lensIndex(synthIx), synth, state.synths),
});

const maybeUpdateMIDINode = (state: SynthDesignerState) => {
  const vcId = state.vcId;
  const stateKey = `synthDesigner_${vcId}`;
  const { midiNode } = getSynthDesignerReduxInfra(stateKey);
  const mailboxIDs = state.synths.map(synth => synth.fmSynth.mailboxID!);
  if (R.equals(mailboxIDs, midiNode.inputCbs.enableRxAudioThreadScheduling?.mailboxIDs)) {
    return;
  }

  midiNode.setInputCbs(() => {
    return {
      enableRxAudioThreadScheduling: { mailboxIDs },
      onAttack: () => {
        throw new UnreachableException(
          'Should never be called; should be handled by audio thread scheduling'
        );
      },
      onRelease: () => {
        throw new UnreachableException(
          'Should never be called; should be handled by audio thread scheduling'
        );
      },
      onPitchBend: () => {
        throw new UnreachableException(
          'Should never be called; should be handled by audio thread scheduling'
        );
      },
      onClearAll: () => {
        throw new UnreachableException(
          'Should never be called; should be handled by audio thread scheduling'
        );
      },
    };
  });
};

const actionGroups = {
  SET_STATE: buildActionGroup({
    actionCreator: (state: SynthDesignerState) => ({ type: 'SET_STATE', state }),
    subReducer: (_state: SynthDesignerState, { state }) => {
      maybeUpdateMIDINode(state);
      return state;
    },
  }),
  ADD_SYNTH_MODULE: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_SYNTH_MODULE' }),
    subReducer: (state: SynthDesignerState) => {
      const newModule = buildDefaultSynthModule(
        state.wavyJonesInstance,
        `synthDesigner_${state.vcId}`,
        FilterType.Lowpass,
        state.synths.length,
        buildDefaultFilterEnvelope({
          phaseIndex: 254,
          debugName: `\`ADD_SYNTH_MODULE\` index ${state.synths.length}`,
        }),
        false
      );

      const newState = {
        ...state,
        synths: [...state.synths, newModule],
      };
      maybeUpdateMIDINode(newState);
      return newState;
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

      const newState = {
        ...state,
        synths: R.remove(index, 1, state.synths),
      };
      maybeUpdateMIDINode(newState);
      return newState;
    },
  }),
  SET_FILTER_ADSR: buildActionGroup({
    actionCreator: (envelope: Adsr, synthIx: number) => ({
      type: 'SET_FILTER_ADSR',
      envelope,
      synthIx,
    }),
    subReducer: (state: SynthDesignerState, { envelope, synthIx }) => {
      const targetSynth = getSynth(synthIx, state.synths);
      targetSynth.fmSynth.handleAdsrChange(-2, {
        ...envelope,
        lenSamples:
          envelope.lengthMode === AdsrLengthMode.Beats
            ? { type: 'beats to samples', value: envelope.lenSamples }
            : { type: 'constant', value: msToSamples(envelope.lenSamples) },
      });

      return setSynth(synthIx, { ...targetSynth, filterEnvelope: envelope }, state);
    },
  }),
  SET_WAVY_JONES_INSTANCE: buildActionGroup({
    actionCreator: (instance: AnalyserNode) => ({ type: 'SET_WAVY_JONES_INSTANCE', instance }),
    subReducer: (state: SynthDesignerState, { instance }) => {
      if (state.spectrumNode) {
        instance.connect(state.spectrumNode);
      }
      (instance as any).isPaused = state.isHidden;

      state.synths.forEach(synth =>
        synth.voices.forEach(voice => voice.outerGainNode.connect(instance))
      );

      return { ...state, wavyJonesInstance: instance };
    },
  }),
  SET_FILTER_PARAM: buildActionGroup({
    actionCreator<K extends keyof FilterParams>(synthIx: number, key: K, val: FilterParams[K]) {
      return { type: 'SET_FILTER_PARAM', synthIx, key, val };
    },
    subReducer: (state: SynthDesignerState, { synthIx, key, val }) => {
      const targetSynth = getSynth(synthIx, state.synths);

      const newSynth = {
        ...targetSynth,
        filterParams: { ...targetSynth.filterParams, ...targetSynth.filterParams, [key]: val },
      };
      const newFilters = updateFilterNode(
        targetSynth.voices.map(v => v.filterNode),
        targetSynth.filterCSNs,
        key as keyof FilterParams,
        val
      );
      if (newFilters) {
        connectOscillators(false, targetSynth);
        disconnectFilterADSRFromFrequencyParams(
          targetSynth.voices,
          targetSynth.fmSynth,
          targetSynth.filterCSNs
        );
        newSynth.voices = newSynth.voices.map((voice, voiceIx) => ({
          ...voice,
          filterNode: newFilters[voiceIx],
        }));
        newSynth.voices.forEach(voice => voice.filterNode.getOutput().connect(voice.outerGainNode));
        if (newSynth.filterEnvelopeEnabled) {
          connectFilterADSRToFrequencyParams(
            newSynth.voices,
            newSynth.fmSynth,
            newSynth.filterCSNs
          );
        } else {
          disconnectFilterADSRFromFrequencyParams(
            newSynth.voices,
            newSynth.fmSynth,
            newSynth.filterCSNs
          );
        }
        connectOscillators(true, newSynth);
      }

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
      const newTargetSynth: SynthModule = { ...targetSynth, masterGain: gain };
      newTargetSynth.voices.forEach(voice => {
        voice.outerGainNode.gain.value = gain + 1;
      });
      return setSynth(synthIx, newTargetSynth, state);
    },
  }),
  SET_VOICE_STATE: buildActionGroup({
    actionCreator: (synthIx: number, preset: SynthVoicePreset | null) => ({
      type: 'SET_VOICE_STATE',
      synthIx,
      preset,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, preset }) => {
      synthIx = synthIx === -1 ? state.synths.length - 1 : synthIx;
      const oldSynthModule = state.synths[synthIx];
      if (!oldSynthModule) {
        console.error(
          `Tried to replace synth index ${synthIx} but only ${state.synths.length} exist`
        );
        return state;
      }
      disposeSynthModule(oldSynthModule);

      const stateKey = `synthDesigner_${state.vcId}`;
      const builtVoice: SynthModule = preset
        ? deserializeSynthModule(state.wavyJonesInstance, preset, stateKey, synthIx)
        : buildDefaultSynthModule(
            state.wavyJonesInstance,
            stateKey,
            FilterType.Lowpass,
            synthIx,
            buildDefaultFilterEnvelope({
              phaseIndex: 254,
              debugName: `\`SET_VOICE_STATE\` synthIx: ${synthIx}`,
            }),
            false
          );

      const newState = { ...state, synths: R.set(R.lensIndex(synthIx), builtVoice, state.synths) };
      maybeUpdateMIDINode(newState);
      return newState;
    },
  }),
  SET_SYNTH_DESIGNER_IS_HIDDEN: buildActionGroup({
    actionCreator: (isHidden: boolean) => ({ type: 'SET_SYNTH_DESIGNER_IS_HIDDEN', isHidden }),
    subReducer: (state: SynthDesignerState, { isHidden }) => {
      if (state.wavyJonesInstance) {
        (state.wavyJonesInstance as any).isPaused = isHidden;
      }

      return { ...state, isHidden };
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
      synth.fmSynth.setFrequencyMultiplier(pitchMultiplier);
      return setSynth(synthIx, { ...synth, pitchMultiplier }, state);
    },
  }),
  SET_SYNTH_PRESET: buildActionGroup({
    actionCreator: (preset: SynthPresetEntry) => ({ type: 'SET_SYNTH_PRESET', preset }),
    subReducer: (state: SynthDesignerState, { preset }) => {
      if (state.synths.length !== 0) {
        throw new Error(
          'Expected that all synths would be removed before dispatching `SET_SYNTH_PRESET`'
        );
      }

      const stateKey = `synthDesigner_${state.vcId}`;
      const synths = preset.body.voices.map((def, i) =>
        deserializeSynthModule(state.wavyJonesInstance, def, stateKey, i)
      );
      for (const synth of state.synths) {
        disposeSynthModule(synth);
      }

      const newState = { ...state, synths };
      maybeUpdateMIDINode(newState);
      return newState;
    },
  }),
  SET_FILTER_IS_BYPASSED: buildActionGroup({
    actionCreator: (synthIx: number, filterBypassed: boolean) => ({
      type: 'SET_FILTER_IS_BYPASSED',
      synthIx,
      filterBypassed,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, filterBypassed }) => {
      const targetSynth = getSynth(synthIx, state.synths);
      if (targetSynth.filterBypassed === filterBypassed) {
        return state;
      }

      connectOscillators(false, targetSynth);
      const newSynth = { ...targetSynth, filterBypassed };
      connectOscillators(true, newSynth);

      if (targetSynth.filterEnvelopeEnabled) {
        connectFilterADSRToFrequencyParams(
          targetSynth.voices,
          targetSynth.fmSynth,
          targetSynth.filterCSNs
        );
      } else {
        disconnectFilterADSRFromFrequencyParams(
          targetSynth.voices,
          targetSynth.fmSynth,
          targetSynth.filterCSNs
        );
      }

      return setSynth(synthIx, newSynth, state);
    },
  }),
  SET_FILTER_ADSR_LENGTH: buildActionGroup({
    actionCreator: (synthIx: number, length: number, lengthMode: AdsrLengthMode) => ({
      type: 'SET_FILTER_ADSR_LENGTH',
      synthIx,
      length,
      lengthMode,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, length, lengthMode }) => {
      const targetSynth = getSynth(synthIx, state.synths);
      targetSynth.fmSynth.handleAdsrChange(-2, {
        ...targetSynth.filterEnvelope,
        lenSamples:
          lengthMode === AdsrLengthMode.Beats
            ? { type: 'beats to samples', value: length }
            : { type: 'constant', value: msToSamples(length) },
      });
      return setSynth(
        synthIx,
        {
          ...targetSynth,
          filterADSRLength: length,
          filterEnvelope: { ...targetSynth.filterEnvelope, lenSamples: length, lengthMode },
        },
        state
      );
    },
  }),
  SET_FILTER_ENVELOPE_ENABLED: buildActionGroup({
    actionCreator: (synthIx: number, enabled: boolean) => ({
      type: 'SET_FILTER_ENVELOPE_ENABLED',
      synthIx,
      enabled,
    }),
    subReducer: (state: SynthDesignerState, { synthIx, enabled }) => {
      const targetSynth = getSynth(synthIx, state.synths);
      if (targetSynth.filterEnvelopeEnabled === enabled) {
        return state;
      }

      if (enabled) {
        connectFilterADSRToFrequencyParams(
          targetSynth.voices,
          targetSynth.fmSynth,
          targetSynth.filterCSNs
        );
      } else {
        disconnectFilterADSRFromFrequencyParams(
          targetSynth.voices,
          targetSynth.fmSynth,
          targetSynth.filterCSNs
        );
      }

      return setSynth(synthIx, { ...targetSynth, filterEnvelopeEnabled: enabled }, state);
    },
  }),
  SET_POLYSYNTH_CTX: buildActionGroup({
    actionCreator: (ctx: PolysynthContext) => ({ type: 'SET_POLYSYNTH_CTX', ctx }),
    subReducer: (state: SynthDesignerState, { ctx }) => ({ ...state, polysynthCtx: ctx }),
  }),
};

interface SynthDesignerStateMapValue extends ReturnType<typeof buildSynthDesignerReduxInfra> {
  reactRoot: ReactDOMRoot | 'NOT_LOADED';
  midiNode: MIDINode;
}

/**
 * Global map of state key to Redux infrastructure
 */
export const SynthDesignerStateByStateKey: Map<string, SynthDesignerStateMapValue> = new Map();

export const getSynthDesignerReduxInfra = (stateKey: string) => {
  const reduxInfra = SynthDesignerStateByStateKey.get(stateKey);
  if (!reduxInfra) {
    throw new Error(`No Redux state entry for state key "${stateKey}"`);
  }

  return reduxInfra;
};

const buildSynthDesignerReduxInfra = (
  vcId: string,
  initialState: SynthDesignerState | null | undefined
) => {
  const mod = buildModule<SynthDesignerState, typeof actionGroups>(
    initialState ?? getInitialSynthDesignerState(vcId),
    actionGroups
  );
  const modules = {
    synthDesigner: mod,
  };

  return buildStore<typeof modules>(modules, undefined, {});
};

export default buildSynthDesignerReduxInfra;
