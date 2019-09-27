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
  oscillators: OscillatorNode[];
  effects: Effect[];
  // The node that connects to all of the oscillators.  This is connected to either the effects
  // chain or directly to the output gain node.
  innerGainNode: GainNode;
  // The node that is connected to whatever the synth module as a whole is connected to.  Its
  // source is either the end of the effects chain or the inner gain node.
  outerGainNode: GainNode;
}

export const serializeSynthModule = (synth: SynthModule) => ({
  oscillatorCount: synth.oscillators.length,
  waveform: synth.waveform,
});

export const deserializeSynthModule = (serialized: string) => {
  const { oscillatorCount, waveform } = JSON.parse(serialized);

  return {
    oscillators: R.range(0, oscillatorCount).map(() => new OscillatorNode(new AudioContext())),
    waveform,
  };
};

export interface SynthDesignerState {
  synths: SynthModule[];
}

const buildDefaultSynthModule = (): SynthModule => {
  const innerGainNode = new GainNode(new AudioContext());
  const outerGainNode = new GainNode(new AudioContext());
  const oscillator = new OscillatorNode(new AudioContext());
  oscillator.connect(innerGainNode);
  innerGainNode.connect(outerGainNode);

  return {
    waveform: Waveform.Sine,
    oscillators: [oscillator],
    effects: [],
    innerGainNode,
    outerGainNode,
  };
};

const getInitialState = (): SynthDesignerState => ({
  synths: [buildDefaultSynthModule()],
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
    subReducer: (state: SynthDesignerState, { index, waveform }) =>
      R.set(R.lensPath(['synths', index, 'waveform']), waveform, state),
  }),
  ADD_SYNTH_MODULE: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_SYNTH_MODULE' }),
    subReducer: (state: SynthDesignerState) => ({
      ...state,
      synths: [...state.synths, buildDefaultSynthModule()],
    }),
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
};

export default buildModule<SynthDesignerState, typeof actionGroups>(
  getInitialState(),
  actionGroups
);
