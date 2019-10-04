import * as R from 'ramda';
import { buildModule, buildActionGroup } from 'jantix';
import { Option } from 'funfix-core';

import { EffectNode } from 'src/synthDesigner/effects';

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

export interface FilterModule {
  node: BiquadFilterNode;
  params: FilterParams;
}

export interface SynthModule {
  waveform: Waveform;
  detune: number;
  oscillators: OscillatorNode[];
  effects: EffectModule[];
  // The node that is connected to whatever the synth module as a whole is connected to.  Its
  // source is either the end of the effects chain or the inner gain node.
  outerGainNode: GainNode;
  filter: FilterModule;
  masterGain: number;
  selectedEffectType: EffectType;
}

const ctx = new AudioContext();

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
];

export const getDefaultFilterParams = (filterType: FilterType): FilterParams =>
  getSettingsForFilterType(filterType).reduce(
    (acc, { label, initial }) => ({ ...acc, [label]: initial }),
    {}
  ) as FilterParams;

function updateFilterNode<K extends keyof FilterParams>(
  node: BiquadFilterNode,
  key: K,
  val: FilterParams[K]
) {
  switch (key) {
    case 'type': {
      node.type = val as FilterType;
      break;
    }
    default: {
      const param: AudioParam = node[key as Exclude<typeof key, 'type'>];
      param.setValueAtTime(val as number, ctx.currentTime);
    }
  }
}

export const serializeSynthModule = (synth: SynthModule) => ({
  unison: synth.oscillators.length,
  waveform: synth.waveform,
  detune: synth.detune,
  filter: synth.filter.params,
  masterGain: synth.masterGain,
  selectedEffectType: synth.selectedEffectType,
});

export interface SynthDesignerState {
  synths: SynthModule[];
  wavyJonesInstance: AnalyserNode | undefined;
  spectrumNode: AnalyserNode | undefined;
}

const buildDefaultFilterModule = (): FilterModule => {
  const node = new BiquadFilterNode(ctx);
  const params = {
    type: FilterType.Lowpass,
    ...getDefaultFilterParams(FilterType.Lowpass),
  };
  Object.entries(params).forEach(([key, val]) =>
    updateFilterNode(node, key as keyof typeof params, val)
  );

  return {
    node,
    params,
  };
};

const buildDefaultSynthModule = (): SynthModule => {
  const filter = buildDefaultFilterModule();
  const outerGainNode = new GainNode(ctx);
  const oscillator = new OscillatorNode(ctx);
  oscillator.start();
  filter.node.connect(outerGainNode);
  outerGainNode.gain.setValueAtTime(0.4, ctx.currentTime);

  return {
    waveform: Waveform.Sine,
    detune: 0,
    oscillators: [oscillator],
    effects: [],
    outerGainNode,
    filter,
    masterGain: 0.4,
    selectedEffectType: EffectType.Reverb,
  };
};

export const deserializeSynthModule = ({
  waveform,
  unison,
  detune,
  filter: filterParams,
  masterGain,
  selectedEffectType,
}: {
  waveform: Waveform;
  unison: number;
  detune: number;
  filter: FilterParams;
  masterGain: number;
  selectedEffectType: EffectType;
}): SynthModule => {
  const base = buildDefaultSynthModule();
  base.oscillators.forEach(osc => {
    osc.stop();
    osc.disconnect();
  });

  const filter = {
    params: filterParams,
    node: new BiquadFilterNode(ctx),
  };
  filter.node.connect(base.outerGainNode);
  Object.entries(filterParams).forEach(([key, val]: [keyof typeof filterParams, any]) =>
    updateFilterNode(filter.node, key, val)
  );

  base.outerGainNode.gain.setValueAtTime(masterGain, ctx.currentTime);

  return {
    ...base,
    oscillators: R.range(0, unison).map(() => {
      const osc = new OscillatorNode(ctx);
      osc.type = waveform;
      osc.detune.setValueAtTime(detune, ctx.currentTime);
      osc.start();
      return osc;
    }),
    waveform,
    detune,
    filter,
    effects: [], // TODO
    masterGain,
    selectedEffectType,
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
  const targetEffect = targetSynth.effects[effectIx];
  if (!targetEffect) {
    throw new Error(
      `Tried to access effect index ${effectIx} on synth index ${synthIx} but it isn't set; only ${targetSynth.effects.length} effects exist`
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
  effect: EffectModule,
  state: SynthDesignerState
): SynthDesignerState => {
  const targetSynth = getSynth(synthIx, state.synths);
  const newSynth = {
    ...targetSynth,
    effects: R.set(R.lensIndex(effectIx), effect, targetSynth.effects),
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
      targetSynth.oscillators.forEach(osc => (osc.type = waveform));
      return R.set(R.lensPath(['synths', index, 'waveform']), waveform, state);
    },
  }),
  ADD_SYNTH_MODULE: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_SYNTH_MODULE' }),
    subReducer: (state: SynthDesignerState) => {
      const newModule = buildDefaultSynthModule();
      newModule.outerGainNode.connect(
        Option.of(state.wavyJonesInstance).getOrElse(ctx.destination)
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
      synths: R.remove(index, 1, state.synths),
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

      const synthOutput = Option.of(R.last(targetSynth.effects))
        .map(R.prop('effect'))
        .map(R.prop('node'))
        .getOrElse(targetSynth.filter.node);

      synthOutput.disconnect();
      synthOutput.connect(effect.node);
      effect.node.connect(targetSynth.outerGainNode);

      const effectGainNode = new GainNode(ctx);
      effectGainNode.gain.setValueAtTime(1, ctx.currentTime);
      const passthroughGainNode = new GainNode(ctx);
      passthroughGainNode.gain.setValueAtTime(0, ctx.currentTime);

      const effectModule: EffectModule = {
        effect,
        effectGainNode,
        passthroughGainNode,
        wetness: 1,
        isBypassed: false,
        params,
      };

      return setSynth(
        synthIx,
        { ...targetSynth, effects: [...targetSynth.effects, effectModule] },
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
      const removedEffect = targetSynth.effects[effectIndex];
      if (!removedEffect) {
        throw new Error(`No effect at index ${synthIx} for synth index ${effectIndex}`);
      }

      removedEffect.effect.node.disconnect();
      const newSrc = Option.of(targetSynth.effects[synthIx - 1])
        .map(R.prop('effect'))
        .map(R.prop('node'))
        .getOrElse(targetSynth.filter.node);
      const newDst = Option.of(targetSynth.effects[effectIndex + 1])
        .map(R.prop('effect'))
        .map(R.prop('node'))
        .getOrElse(targetSynth.outerGainNode);

      removedEffect.effect.node.disconnect();
      newSrc.disconnect();
      newSrc.connect(newDst);

      return setSynth(
        synthIx,
        { ...targetSynth, effects: R.remove(effectIndex, 1, targetSynth.effects) },
        state
      );
    },
  }),
  GATE: buildActionGroup({
    actionCreator: (frequency: number, synthIx?: number) => ({ type: 'GATE', frequency, synthIx }),
    subReducer: (state: SynthDesignerState, { frequency, synthIx }) => {
      const setFreqForOsc = mkSetFreqForOsc(frequency);

      if (R.isNil(synthIx)) {
        state.synths.map(({ filter, oscillators }) =>
          oscillators.forEach(osc => {
            setFreqForOsc(osc);
            osc.connect(filter.node);
          })
        );
      } else {
        const synth = getSynth(synthIx, state.synths);
        synth.oscillators.forEach(osc => {
          setFreqForOsc(osc);
          osc.connect(synth.filter.node);
        });
      }

      return state;
    },
  }),
  UNGATE: buildActionGroup({
    actionCreator: (synthIx?: number) => ({ type: 'UNGATE', synthIx }),
    subReducer: (state: SynthDesignerState, { synthIx }) => {
      if (R.isNil(synthIx)) {
        state.synths.flatMap(R.prop('oscillators')).forEach(osc => osc.disconnect());
      } else {
        getSynth(synthIx, state.synths).oscillators.forEach(osc => osc.disconnect());
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

      while (targetSynth.oscillators.length > unison) {
        const osc = targetSynth.oscillators.pop()!;
        osc.stop();
        osc.disconnect();
      }

      while (targetSynth.oscillators.length < unison) {
        const osc = new OscillatorNode(ctx);
        osc.connect(targetSynth.filter.node);
        // TODO: Set detune and other params here once they are implemented and stored in state
        // TODO: Keep track of playing state for all synths and trigger oscillators if synth is playing
        osc.type = targetSynth.waveform;
        targetSynth.oscillators.push(osc);
      }

      return {
        ...state,
        synths: [
          ...state.synths.slice(0, synthIx),
          { ...targetSynth, oscillators: [...targetSynth.oscillators] },
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
            synth.oscillators.forEach(osc => osc.detune.setValueAtTime(detune, ctx.currentTime));

            return { ...synth, detune };
          }, []),
        };
      }

      const targetSynth = getSynth(synthIx, state.synths);
      targetSynth.oscillators.forEach(osc => osc.detune.setValueAtTime(detune, ctx.currentTime));

      return setSynth(synthIx, { ...targetSynth, detune }, state);
    },
  }),
  SET_WAVY_JONES_INSTANCE: buildActionGroup({
    actionCreator: (instance: AnalyserNode) => ({ type: 'SET_WAVY_JONES_INSTANCE', instance }),
    subReducer: (state: SynthDesignerState, { instance }) => {
      state.synths.forEach(({ outerGainNode }) => outerGainNode.connect(instance));

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
      return setEffect(synthIx, effectIx, { ...targetEffect, isBypassed }, state);
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

      targetEffect.effectGainNode.gain.setValueAtTime(wetness, ctx.currentTime);
      targetEffect.passthroughGainNode.gain.setValueAtTime(1 - wetness, ctx.currentTime);

      return setEffect(synthIx, effectIx, { ...targetEffect, wetness }, state);
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
      targetEffect.effect.node.setParam(key, val);

      return setEffect(
        synthIx,
        effectIx,
        { ...targetEffect, params: { ...targetEffect.params, [key]: val } },
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

      updateFilterNode(targetSynth.filter.node, key as keyof FilterParams, val);
      return state;

      const newSynth = {
        ...targetSynth,
        filter: { ...targetSynth.filter, params: { ...targetSynth.filter.params, [key]: val } },
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
      targetSynth.outerGainNode.gain.setValueAtTime(gain, ctx.currentTime);
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
