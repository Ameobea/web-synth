import * as R from 'ramda';
import { buildStore, buildActionGroup, buildModule } from 'jantix';
import { UnreachableException } from 'ameo-utils';

import { SampleDescriptor } from 'src/sampleLibrary';
import { MIDINode, buildMIDINode } from 'src/patchNetwork/midiNode';
import { buildGateOutput } from 'src/sequencer';
import { initScheduler, stopScheduler, mkBeatScheduler } from 'src/sequencer/scheduler';

export type VoiceTarget =
  | { type: 'sample' }
  | { type: 'midi'; synthIx: number | null; note: number }
  | { type: 'gate'; gateIx: number | null | 'RISING_EDGE_DETECTOR' };

export type PlayingStatus = { type: 'NOT_PLAYING' } | { type: 'PLAYING'; intervalHandle: number };

export enum SchedulerScheme {
  Stable,
  Swung,
  Random,
}

export const getIsSequencerPlaying = (playingStatus: PlayingStatus) =>
  playingStatus.type === 'PLAYING';

export interface SequencerReduxState {
  currentEditingVoiceIx: number;
  activeBeat: number;
  voices: VoiceTarget[];
  sampleBank: { [voiceIx: number]: { descriptor: SampleDescriptor; buffer: AudioBuffer } | null };
  /**
   * For each voice, an array of the indices of all marked cells for that voice/row
   */
  marks: boolean[][];
  bpm: number;
  playingStatus: PlayingStatus;
  outputGainNode: GainNode;
  midiOutputs: MIDINode[];
  gateOutputs: ConstantSourceNode[];
  schedulerScheme: SchedulerScheme;
  risingEdgeDetector: AudioWorkletNode | undefined;
}

const ctx = new AudioContext();

const actionGroups = {
  SET_STATE: buildActionGroup({
    actionCreator: (newState: SequencerReduxState) => ({ type: 'SET_STATE', newState }),
    subReducer: (_state: SequencerReduxState, { newState }) => newState,
  }),
  ADD_VOICE: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_VOICE' }),
    subReducer: (state: SequencerReduxState) => ({
      ...state,
      marks: [...state.marks, R.times(() => false, state.marks[0]!.length)],
      voices: [...state.voices, { type: 'sample' as const }],
    }),
  }),
  REMOVE_VOICE: buildActionGroup({
    actionCreator: (voiceIx: number) => ({ type: 'REMOVE_VOICE', voiceIx }),
    subReducer: (state: SequencerReduxState, { voiceIx }) => {
      // Always must have at least one voice
      if (state.marks.length === 1) {
        return state;
      }

      return {
        ...state,
        marks: R.remove(voiceIx, 1, state.marks),
      };
    },
  }),
  MARK: buildActionGroup({
    actionCreator: (rowIx: number, colIx: number) => ({ type: 'MARK', rowIx, colIx }),
    subReducer: (state: SequencerReduxState, { rowIx, colIx }) => ({
      ...state,
      marks: R.set(R.lensPath([rowIx, colIx]), true, state.marks),
    }),
  }),
  UNMARK: buildActionGroup({
    actionCreator: (rowIx: number, colIx: number) => ({ type: 'UNMARK', rowIx, colIx }),
    subReducer: (state: SequencerReduxState, { rowIx, colIx }) => ({
      ...state,
      marks: R.set(R.lensPath([rowIx, colIx]), false, state.marks),
    }),
  }),
  TOGGLE_IS_PLAYING: buildActionGroup({
    actionCreator: () => ({ type: 'TOGGLE_IS_PLAYING' }),
    subReducer: (state: SequencerReduxState) => {
      const isPlaying = !getIsSequencerPlaying(state.playingStatus);

      if (isPlaying) {
        return {
          ...state,
          playingStatus: { type: 'PLAYING' as const, intervalHandle: initScheduler(state) },
        };
      } else {
        if (state.playingStatus.type !== 'PLAYING') {
          console.error("Tried to stop sequencer when it wasn't playing");
          return state;
        }
        stopScheduler(state.playingStatus.intervalHandle, state);
        return { ...state, playingStatus: { type: 'NOT_PLAYING' as const } };
      }
    },
  }),
  SET_VOICE_TARGET: buildActionGroup({
    actionCreator: (voiceIx: number, newTarget: VoiceTarget) => ({
      type: 'SET_VOICE_TARGET',
      voiceIx,
      newTarget,
    }),
    subReducer: (state: SequencerReduxState, { voiceIx, newTarget }) => ({
      ...state,
      voices: R.set(R.lensIndex(voiceIx), newTarget, state.voices),
    }),
  }),
  ADD_MIDI_OUTPUT: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_MIDI_OUTPUT' }),
    subReducer: (state: SequencerReduxState) => ({
      ...state,
      midiOutputs: [
        ...state.midiOutputs,
        buildMIDINode(() => {
          throw new UnreachableException('MIDI output of sequencer has no inputs');
        }),
      ],
    }),
  }),
  REMOVE_MIDI_OUTPUT: buildActionGroup({
    actionCreator: (index: number) => ({ type: 'REMOVE_MIDI_OUTPUT', index }),
    subReducer: (state: SequencerReduxState, { index }) => {
      const removed = state.midiOutputs[index];
      if (!removed) {
        return state;
      }

      // Disconnect any voices that were targeting this output
      const updatedVoices = state.voices.map(voice => {
        if (voice.type !== 'midi' || voice.synthIx !== index) {
          return voice;
        }

        return { ...voice, synthIx: null };
      });

      removed.disconnect();
      removed.getInputCbs().onClearAll();

      return {
        ...state,
        voices: updatedVoices,
        midiOutputs: R.init(state.midiOutputs),
      };
    },
  }),
  SET_BPM: buildActionGroup({
    actionCreator: (bpm: number | string) => ({ type: 'SET_BPM', bpm }),
    subReducer: (state: SequencerReduxState, { bpm }) => R.set(R.lensProp('bpm'), +bpm, state),
  }),
  ADD_GATE_OUTPUT: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_GATE_OUTPUT' }),
    subReducer: (state: SequencerReduxState) => ({
      ...state,
      gateOutputs: [...state.gateOutputs, buildGateOutput()],
    }),
  }),
  SET_RISING_EDGE_DETECTOR: buildActionGroup({
    actionCreator: (detector: AudioWorkletNode) => ({ type: 'SET_RISING_EDGE_DETECTOR', detector }),
    subReducer: (state: SequencerReduxState, { detector }) => ({
      ...state,
      risingEdgeDetector: detector,
    }),
  }),
  INCREMENT_BEAT: buildActionGroup({
    actionCreator: () => ({ type: 'INCREMENT_BEAT' }),
    subReducer: (state: SequencerReduxState) => ({
      ...state,
      activeBeat: (state.activeBeat + 1) % state.marks[0]!.length,
    }),
  }),
  ADD_SAMPLE: buildActionGroup({
    actionCreator: (voiceIx: number, descriptor: SampleDescriptor, sampleData: AudioBuffer) => ({
      type: 'ADD_SAMPLE',
      voiceIx,
      descriptor,
      sampleData,
    }),
    subReducer: (state: SequencerReduxState, { voiceIx, descriptor, sampleData }) => ({
      ...state,
      sampleBank: { ...state.sampleBank, [voiceIx]: { descriptor, buffer: sampleData } },
    }),
  }),
  SET_CURRENTLY_EDITING_VOICE_IX: buildActionGroup({
    actionCreator: (voiceIx: number) => ({ type: 'SET_CURRENTLY_EDITING_VOICE_IX', voiceIx }),
    subReducer: (state: SequencerReduxState, { voiceIx }) => {
      // Play a single beat of the voice now if the sequencer isn't currently playing
      if (!getIsSequencerPlaying(state.playingStatus)) {
        console.log('playing s');
        mkBeatScheduler(
          state,
          { scheduledBuffers: [] },
          voiceIx,
          state.voices[voiceIx]
        )(ctx.currentTime);
      }

      return {
        ...state,
        currentEditingVoiceIx: voiceIx,
      };
    },
  }),
};

export const buildSequencerReduxInfra = (initialState: SequencerReduxState) => {
  const modules = {
    sequencer: buildModule<SequencerReduxState, typeof actionGroups>(initialState, actionGroups),
  };

  return buildStore<typeof modules>(modules);
};

export type SequencerReduxInfra = ReturnType<typeof buildSequencerReduxInfra>;

const DEFAULT_WIDTH = 16 as const;

export const buildInitialState = (): SequencerReduxState => ({
  currentEditingVoiceIx: 0,
  activeBeat: 0,
  voices: [{ type: 'sample' as const }],
  sampleBank: {},
  marks: [R.times(() => false, DEFAULT_WIDTH)],
  bpm: 80,
  playingStatus: { type: 'NOT_PLAYING' as const },
  outputGainNode: new GainNode(ctx),
  midiOutputs: [],
  gateOutputs: [],
  schedulerScheme: SchedulerScheme.Stable,
  risingEdgeDetector: undefined,
});
