import * as R from 'ramda';
import { buildModule, buildActionGroup } from 'jantix';
import { Option } from 'funfix-core';

import { Bitcrusher, Distortion, Reverb } from 'src/synthDesigner/effects';

export enum Waveform {
  Sine = 'sine',
  Square = 'square',
  Sawtooth = 'sawtooth',
  Triangle = 'triangle',
  Custom = 'custom',
}

export type Effect =
  | { type: 'bitcrusher'; node: Bitcrusher }
  | { type: 'distortion'; node: Distortion }
  | { type: 'reverb'; node: Reverb };

export interface SynthModule {
  waveform: Waveform;
  detune: number;
  oscillators: OscillatorNode[];
  effects: Effect[];
  // The node that connects to all of the oscillators.  This is connected to either the effects
  // chain or directly to the output gain node.
  innerGainNode: GainNode;
  // The node that is connected to whatever the synth module as a whole is connected to.  Its
  // source is either the end of the effects chain or the inner gain node.
  outerGainNode: GainNode;
}

const ctx = new AudioContext();

export const serializeSynthModule = (synth: SynthModule) => ({
  unison: synth.oscillators.length,
  waveform: synth.waveform,
  detune: synth.detune,
});

export interface SynthDesignerState {
  synths: SynthModule[];
  wavyJonesInstance: AnalyserNode | undefined;
}

const buildDefaultSynthModule = (): SynthModule => {
  const innerGainNode = new GainNode(ctx);
  const outerGainNode = new GainNode(ctx);
  const oscillator = new OscillatorNode(ctx);
  oscillator.start();
  innerGainNode.connect(outerGainNode);
  innerGainNode.gain.setValueAtTime(0.4, ctx.currentTime);
  // TODO: Connect this somewhere else perhaps?  To a master gain?
  // outerGainNode.connect(ctx.destination);
  outerGainNode.gain.setValueAtTime(0.4, ctx.currentTime);

  return {
    waveform: Waveform.Sine,
    detune: 0,
    oscillators: [oscillator],
    effects: [],
    innerGainNode,
    outerGainNode,
  };
};

export const deserializeSynthModule = ({
  waveform,
  unison,
  detune,
}: {
  waveform: Waveform;
  unison: number;
  detune: number;
}): SynthModule => {
  const base = buildDefaultSynthModule();
  base.oscillators.forEach(osc => {
    osc.stop();
    osc.disconnect();
  });

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
    effects: [], // TODO
  };
};

export const getInitialSynthDesignerState = (addInitialSynth?: boolean): SynthDesignerState => ({
  synths: addInitialSynth ? [buildDefaultSynthModule()] : [],
  wavyJonesInstance: undefined,
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

const mkSetFreqForOsc = (frequency: number) => (osc: OscillatorNode) =>
  osc.frequency.setValueAtTime(frequency + Math.random() * 6, ctx.currentTime); // TODO: Remove

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
    actionCreator: (index: number, effect: Effect) => ({ type: 'ADD_EFFECT', index, effect }),
    subReducer: (state: SynthDesignerState, { index, effect }) => {
      const targetSynth = getSynth(index, state.synths);

      const synthOutput = Option.of(R.last(targetSynth.effects))
        .map(R.prop('node'))
        .getOrElse(targetSynth.innerGainNode);

      synthOutput.disconnect();
      synthOutput.connect(effect.node);
      effect.node.connect(targetSynth.outerGainNode);

      return {
        ...state,
        synths: R.set(
          R.lensIndex(index),
          { ...targetSynth, effects: [...targetSynth.effects, effect] },
          state.synths
        ),
      };
    },
  }),
  REMOVE_EFFECT: buildActionGroup({
    actionCreator: (synthIndex: number, effectIndex: number) => ({
      type: 'REMOVE_EFFECT',
      synthIndex,
      effectIndex,
    }),
    subReducer: (state: SynthDesignerState, { synthIndex, effectIndex }) => {
      const targetSynth = getSynth(synthIndex, state.synths);
      const removedEffect = targetSynth.effects[effectIndex];
      if (!removedEffect) {
        throw new Error(`No effect at index ${synthIndex} for synth index ${effectIndex}`);
      }

      removedEffect.node.disconnect();
      const newSrc = Option.of(targetSynth.effects[synthIndex - 1])
        .map(R.prop('node'))
        .getOrElse(targetSynth.innerGainNode);
      const newDst = Option.of(targetSynth.effects[effectIndex + 1])
        .map(R.prop('node'))
        .getOrElse(targetSynth.outerGainNode);

      removedEffect.node.disconnect();
      newSrc.disconnect();
      newSrc.connect(newDst);

      return {
        ...state,
        synths: R.remove(effectIndex, 1, state.synths),
      };
    },
  }),
  GATE: buildActionGroup({
    actionCreator: (frequency: number, synthIx?: number) => ({ type: 'GATE', frequency, synthIx }),
    subReducer: (state: SynthDesignerState, { frequency, synthIx }) => {
      const setFreqForOsc = mkSetFreqForOsc(frequency);

      if (R.isNil(synthIx)) {
        state.synths.map(({ innerGainNode, oscillators }) =>
          oscillators.forEach(osc => {
            setFreqForOsc(osc);
            osc.connect(innerGainNode);
          })
        );
      } else {
        const synth = getSynth(synthIx, state.synths);
        synth.oscillators.forEach(osc => {
          setFreqForOsc(osc);
          osc.connect(synth.innerGainNode);
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
        osc.connect(targetSynth.innerGainNode);
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
    actionCreator: (synthIx: number, detune: number) => ({ type: 'SET_DETUNE', synthIx, detune }),
    subReducer: (state: SynthDesignerState, { synthIx, detune }) => {
      const targetSynth = getSynth(synthIx, state.synths);
      targetSynth.oscillators.forEach(osc => osc.detune.setValueAtTime(detune, ctx.currentTime));

      return {
        ...state,
        synths: R.set(R.lensIndex(synthIx), { ...targetSynth, detune }, state.synths),
      };
    },
  }),
  SET_WAVY_JONES_INSTANCE: buildActionGroup({
    actionCreator: (instance: AnalyserNode) => ({ type: 'SET_WAVY_JONES_INSTANCE', instance }),
    subReducer: (state: SynthDesignerState, { instance }) => {
      state.synths.forEach(({ outerGainNode }) => outerGainNode.connect(instance));

      instance.connect(ctx.destination);

      return { ...state, wavyJonesInstance: instance };
    },
  }),
};

export default buildModule<SynthDesignerState, typeof actionGroups>(
  getInitialSynthDesignerState(),
  actionGroups
);
