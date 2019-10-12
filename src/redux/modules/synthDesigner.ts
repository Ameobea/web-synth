import * as R from 'ramda';
import { buildModule, buildActionGroup } from 'jantix';
import { Option } from 'funfix-core';

import { EffectNode } from 'src/synthDesigner/effects';
import { ADSRValues, defaultAdsrEnvelope, ControlPanelADSR } from 'src/controls/adsr';
import { ADSRModule } from 'src/synthDesigner/ADSRModule';

export enum Waveform {
  Sine = 'sine',
  Square = 'square',
  Sawtooth = 'sawtooth',
  Triangle = 'triangle',
  Custom = 'custom',
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
  frequencyCSN: ConstantSourceNode;
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
  filterParams: FilterParams;
  filterCSNs: FilterCSNs;
  masterGain: number;
  masterGainCSN: ConstantSourceNode;
  selectedEffectType: EffectType;
  gainEnvelope: ADSRValues;
  gainADSRLength: number;
  filterEnvelope: ADSRValues;
  filterADSRLength: number;
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

export const serializeSynthModule = (synth: SynthModule) => ({
  unison: synth.voices[0].oscillators.length,
  waveform: synth.waveform,
  detune: synth.detune,
  filter: synth.filterParams,
  masterGain: synth.masterGain,
  selectedEffectType: synth.selectedEffectType,
  gainEnvelope: synth.gainEnvelope,
  gainADSRLength: synth.gainADSRLength,
  filterEnvelope: synth.filterEnvelope,
  filterADSRLength: synth.filterADSRLength,
});

export interface SynthDesignerState {
  synths: SynthModule[];
  wavyJonesInstance: AnalyserNode | undefined;
  spectrumNode: AnalyserNode | undefined;
}

const buildDefaultFilterCSNs = (): FilterCSNs => ({
  frequency: new ConstantSourceNode(ctx),
  Q: new ConstantSourceNode(ctx),
  gain: new ConstantSourceNode(ctx),
  detune: new ConstantSourceNode(ctx),
});

const buildDefaultFilterModule = (
  filterCSNs: FilterCSNs
): {
  filterParams: FilterParams;
  filterNode: BiquadFilterNode;
} => {
  const filterNode = new BiquadFilterNode(ctx);
  const filterParams = {
    type: FilterType.Lowpass,
    ...getDefaultFilterParams(FilterType.Lowpass),
  };
  filterCSNs.frequency.connect(filterNode.frequency);
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

  const masterGain = 0.4;
  const masterGainCSN = new ConstantSourceNode(ctx);
  masterGainCSN.offset.setValueAtTime(masterGain, ctx.currentTime);
  const inst: SynthModule = {
    waveform: Waveform.Sine,
    detune: 0,
    detuneCSN: new ConstantSourceNode(ctx),
    voices: R.range(0, VOICE_COUNT).map(() => {
      const outerGainNode = new GainNode(ctx);
      outerGainNode.gain.setValueAtTime(0, ctx.currentTime);

      const oscillator = new OscillatorNode(ctx);
      oscillator.start();

      const { filterNode } = buildDefaultFilterModule(filterCSNs);
      filterNode.connect(outerGainNode);

      // Start the gain ADSR module and configure it to modulate the voice's gain node
      const gainADSRModule = new ADSRModule(ctx, { minValue: 0, maxValue: 1.8, lengthMs: 1000 });
      gainADSRModule.start();
      gainADSRModule.connect(outerGainNode.gain);
      // Start the filter ADSR module and configure it to modulate the voice's filter node's frequency
      const filterADSRModule = new ADSRModule(ctx, {
        minValue: 0,
        maxValue: 10000,
        lengthMs: 2000,
      });
      filterADSRModule.start();
      filterADSRModule.connect(filterCSNs.frequency.offset);

      // Connect the mast gain to the ADSR so that we can sum the offsets
      // For whatever reason, you can't connect two CSNs to the same `AudioParam`; it just doesn't seem to work.
      masterGainCSN.connect(gainADSRModule.offset);

      return {
        oscillators: [oscillator],
        frequencyCSN: new ConstantSourceNode(ctx),
        effects: [],
        outerGainNode,
        filterNode,
        gainADSRModule,
        filterADSRModule,
      };
    }),
    filterParams,
    filterCSNs,
    masterGain,
    masterGainCSN,
    selectedEffectType: EffectType.Reverb,
    gainEnvelope: defaultAdsrEnvelope,
    gainADSRLength: 1000,
    filterEnvelope: defaultAdsrEnvelope,
    filterADSRLength: 1200,
  };

  // Connect up + start all the CSNs
  inst.voices.flatMap(R.prop('oscillators')).forEach(osc => inst.detuneCSN.connect(osc.detune));
  inst.detuneCSN.start();
  inst.masterGainCSN.offset.setValueAtTime(masterGain, ctx.currentTime);
  inst.masterGainCSN.start();

  inst.voices.forEach(voice => {
    voice.oscillators.forEach(osc => voice.frequencyCSN.connect(osc.frequency));
    voice.frequencyCSN.start();
  });

  filterCSNs.detune.start();
  filterCSNs.frequency.start();
  filterCSNs.gain.start();
  filterCSNs.Q.start();

  return inst;
};

export const deserializeSynthModule = ({
  waveform,
  unison,
  detune,
  filter: filterParams,
  masterGain,
  selectedEffectType,
  gainEnvelope,
  gainADSRLength,
  filterEnvelope,
  filterADSRLength,
}: {
  waveform: Waveform;
  unison: number;
  detune: number;
  filter: FilterParams;
  masterGain: number;
  selectedEffectType: EffectType;
  gainEnvelope: ADSRValues;
  gainADSRLength: number;
  filterEnvelope: ADSRValues;
  filterADSRLength: number;
}): SynthModule => {
  const base = buildDefaultSynthModule();
  const voices = base.voices.map(voice => {
    voice.oscillators.forEach(osc => {
      osc.stop();
      osc.disconnect();
    });
    voice.filterNode.disconnect();

    const filterNode = new BiquadFilterNode(ctx);
    filterNode.connect(voice.outerGainNode);
    Object.entries(filterParams).forEach(([key, val]: [keyof typeof filterParams, any]) =>
      updateFilterNode([filterNode], base.filterCSNs, key, val)
    );

    // TODO: the envelope should probably eventually be set via CSN...
    voice.gainADSRModule.setEnvelope(gainEnvelope);
    voice.gainADSRModule.setLengthMs(gainADSRLength);

    voice.filterADSRModule.setEnvelope(filterEnvelope);
    voice.filterADSRModule.setLengthMs(filterADSRLength);

    return {
      ...voice,
      oscillators: R.range(0, unison).map(() => {
        const osc = new OscillatorNode(ctx);
        osc.type = waveform;
        osc.detune.setValueAtTime(0, ctx.currentTime);
        voice.frequencyCSN.connect(osc.frequency);
        base.detuneCSN.connect(osc.detune);
        osc.start();
        return osc;
      }),
      filterNode,
      effects: [], // TODO
    };
  });

  base.masterGainCSN.offset.setValueAtTime(masterGain, ctx.currentTime);

  return {
    ...base,
    waveform,
    detune,
    voices,
    masterGain,
    selectedEffectType,
    gainEnvelope,
    gainADSRLength,
    filterEnvelope,
    filterADSRLength,
  };
};

export const getInitialSynthDesignerState = (addInitialSynth?: boolean): SynthDesignerState => ({
  synths: addInitialSynth ? [buildDefaultSynthModule()] : [],
  wavyJonesInstance: undefined,
  spectrumNode: undefined,
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

const mkSetFreqForOsc = (frequency: number) => (osc: OscillatorNode) =>
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);

const actionGroups = {
  SET_STATE: buildActionGroup({
    actionCreator: (state: SynthDesignerState) => ({ type: 'SET_STATE', state }),
    subReducer: (_state: SynthDesignerState, { state }) => state,
  }),
  SET_WAVEFORM: buildActionGroup({
    actionCreator: (index: number, waveform: Waveform) => ({
      type: 'SET_WAVEFORM',
      index,
      waveform,
    }),
    subReducer: (state: SynthDesignerState, { index, waveform }) => {
      const targetSynth = getSynth(index, state.synths);
      targetSynth.voices.flatMap(R.prop('oscillators')).forEach(osc => (osc.type = waveform));
      return R.set(R.lensPath(['synths', index, 'waveform']), waveform, state);
    },
  }),
  ADD_SYNTH_MODULE: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_SYNTH_MODULE' }),
    subReducer: (state: SynthDesignerState) => {
      const newModule = buildDefaultSynthModule();
      newModule.voices
        .map(R.prop('outerGainNode'))
        .forEach(outerGainNode =>
          outerGainNode.connect(Option.of(state.wavyJonesInstance).getOrElse(ctx.destination))
        );

      return {
        ...state,
        synths: [...state.synths, newModule],
      };
    },
  }),
  DELETE_SYNTH_MODULE: buildActionGroup({
    actionCreator: (index: number) => ({ type: 'DELETE_SYNTH_MODULE', index }),
    subReducer: (state: SynthDesignerState, { index }) => ({
      ...state,
      synths: R.remove(index, 1, state.synths), // TODO: There's probably some disconnecting/freeing that has to happen here...
    }),
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
    actionCreator: (frequency: number, voiceIx: number, synthIx?: number) => ({
      type: 'GATE',
      frequency,
      voiceIx,
      synthIx,
    }),
    subReducer: (state: SynthDesignerState, { frequency, voiceIx, synthIx }) => {
      const setFreqForOsc = mkSetFreqForOsc(frequency);

      // TODO: Dedup
      if (R.isNil(synthIx)) {
        state.synths.forEach(synth => {
          const targetVoice = synth.voices[voiceIx];

          // Trigger gain and filter ADSRs
          targetVoice.gainADSRModule.gate();
          targetVoice.filterADSRModule.gate();

          targetVoice.oscillators.forEach(osc => {
            setFreqForOsc(osc);
            osc.connect(targetVoice.filterNode);
          });
        });
      } else {
        const targetSynth = getSynth(synthIx, state.synths);
        const targetVoice = targetSynth.voices[voiceIx];

        // Trigger gain and filter ADSRs
        targetVoice.gainADSRModule.gate();
        targetVoice.filterADSRModule.gate();

        targetVoice.oscillators.forEach(osc => {
          setFreqForOsc(osc);
          osc.connect(targetVoice.filterNode);
        });
      }

      return state;
    },
  }),
  UNGATE: buildActionGroup({
    actionCreator: (voiceIx: number, synthIx?: number) => ({ type: 'UNGATE', voiceIx, synthIx }),
    subReducer: (state: SynthDesignerState, { voiceIx, synthIx }) => {
      if (R.isNil(synthIx)) {
        state.synths
          .map(({ voices }) => {
            const targetVoice = voices[voiceIx];

            // Trigger release of gain and filter ADSRs
            targetVoice.gainADSRModule.ungate();
            targetVoice.filterADSRModule.ungate();

            return targetVoice;
          })
          .flatMap(R.prop('oscillators'))
          .forEach(osc => osc.disconnect());
      } else {
        const targetSynth = getSynth(synthIx, state.synths);
        const targetVoice = targetSynth.voices[voiceIx];

        // Trigger release of gain and filter ADSRs
        targetVoice.gainADSRModule.ungate();
        targetVoice.filterADSRModule.ungate();

        targetVoice.oscillators.forEach(osc => osc.disconnect());
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
          osc.type = targetSynth.waveform;
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
        state.spectrumNode.connect(ctx.destination);
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
  SET_SPECTRUM_NODE: buildActionGroup({
    actionCreator: (spectrumNode: AnalyserNode) => ({ type: 'SET_SPECTRUM_NODE', spectrumNode }),
    subReducer: (state: SynthDesignerState, { spectrumNode }) => {
      if (!state.wavyJonesInstance || !state.wavyJonesInstance) {
        return { ...state, spectrumNode };
      }

      spectrumNode.disconnect();
      state.wavyJonesInstance.connect(spectrumNode);
      spectrumNode.connect(ctx.destination);

      return { ...state, spectrumNode };
    },
  }),
};

export default buildModule<SynthDesignerState, typeof actionGroups>(
  getInitialSynthDesignerState(),
  actionGroups
);
