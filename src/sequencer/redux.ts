import * as R from 'ramda';
import { buildStore, buildActionGroup, buildModule } from 'jantix';
import { UnreachableException } from 'ameo-utils';

import { SampleDescriptor } from 'src/sampleLibrary';
import { MIDINode, buildMIDINode, MIDIInputCbs } from 'src/patchNetwork/midiNode';
import { buildGateOutput } from 'src/sequencer';
import { SequencerBeatPlayerByVoiceType } from 'src/sequencer/scheduler';

export type VoiceTarget =
  | { type: 'sample' }
  | {
      type: 'midi';
      synthIx: number | null;
      note: number;
    }
  | { type: 'gate'; gateIx: number | null };

export enum SchedulerScheme {
  Stable,
  Swung,
  Random,
}

export type SequencerMark =
  | { type: 'gate' }
  | { type: 'sample'; gain: number }
  | { type: 'midi'; note: number; gain: number };

const buildDefaultSequencerMark = (voice: VoiceTarget): SequencerMark => {
  switch (voice.type) {
    case 'gate':
      return { type: 'gate' };
    case 'midi':
      return { type: 'midi', gain: 1, note: 60 };
    case 'sample':
      return { type: 'sample', gain: 1 };
  }
};

export interface SequencerEditState {
  voiceIx: number;
  editingMarkIx: number | null;
}

export interface SequencerReduxState {
  currentEditingVoiceIx: number;
  activeBeats: number[];
  voices: VoiceTarget[];
  sampleBank:
    | { [voiceIx: number]: { descriptor: SampleDescriptor; buffer: AudioBuffer } | null }
    | 'LOADING';
  /**
   * For each voice, an array of the indices of all marked cells for that voice/row
   */
  marks: (SequencerMark | null)[][];
  bpm: number;
  isPlaying: boolean;
  outputGainNode: GainNode;
  midiOutputs: MIDINode[];
  gateOutputs: ConstantSourceNode[];
  schedulerScheme: SchedulerScheme;
  awpHandle: AudioWorkletNode | undefined;
  inputMIDINode: MIDINode;
  markEditState: SequencerEditState | null;
}

const ctx = new AudioContext();

interface SequencerVoiceAWPConfig {
  beatRatio: number;
  marks: boolean[];
}

interface SequencerAWPConfig {
  beatCount: number;
  voices: SequencerVoiceAWPConfig[];
}

export const buildSequencerConfig = (state: SequencerReduxState): SequencerAWPConfig => {
  return {
    beatCount: state.marks[0]!.length,
    voices: state.marks.map(marks => ({ marks: marks.map(mark => !!mark), beatRatio: 0.25 })),
  };
};

const reschedule = (state: SequencerReduxState): SequencerReduxState => {
  if (!state.awpHandle) {
    return state;
  }

  state.awpHandle.port.postMessage({ type: 'configure', config: buildSequencerConfig(state) });

  return state;
};

export const SequencerReduxInfraMap: Map<string, SequencerReduxInfra> = new Map();

const actionGroups = {
  SET_STATE: buildActionGroup({
    actionCreator: (newState: SequencerReduxState) => ({ type: 'SET_STATE', newState }),
    subReducer: (_state: SequencerReduxState, { newState }) => newState,
  }),
  ADD_VOICE: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_VOICE' }),
    subReducer: (state: SequencerReduxState) => ({
      ...state,
      marks: [...state.marks, R.times(() => null, state.marks[0]!.length)],
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
    subReducer: (state: SequencerReduxState, { rowIx, colIx }) =>
      reschedule({
        ...state,
        marks: R.set(
          R.lensPath([rowIx, colIx]),
          buildDefaultSequencerMark(state.voices[rowIx]),
          state.marks
        ),
      }),
  }),
  UNMARK: buildActionGroup({
    actionCreator: (rowIx: number, colIx: number) => ({ type: 'UNMARK', rowIx, colIx }),
    subReducer: (state: SequencerReduxState, { rowIx, colIx }) =>
      reschedule({
        ...state,
        marks: R.set(R.lensPath([rowIx, colIx]), null, state.marks),
      }),
  }),
  TOGGLE_IS_PLAYING: buildActionGroup({
    actionCreator: () => ({ type: 'TOGGLE_IS_PLAYING' }),
    subReducer: (state: SequencerReduxState) => {
      if (!state.awpHandle) {
        return state;
      }

      if (state.isPlaying) {
        state.awpHandle.port.postMessage({ type: 'stop' });
        return { ...state, isPlaying: false };
      } else {
        state.awpHandle.port.postMessage({ type: 'start' });
        return reschedule({
          ...state,
          isPlaying: true,
        });
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
      removed.inputCbs.onClearAll(true);

      return {
        ...state,
        voices: updatedVoices,
        midiOutputs: R.init(state.midiOutputs),
      };
    },
  }),
  ADD_GATE_OUTPUT: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_GATE_OUTPUT' }),
    subReducer: (state: SequencerReduxState) => ({
      ...state,
      gateOutputs: [...state.gateOutputs, buildGateOutput()],
    }),
  }),
  SET_AWP_HANDLE: buildActionGroup({
    actionCreator: (awpHandle: AudioWorkletNode) => ({ type: 'SET_AWP_HANDLE', awpHandle }),
    subReducer: (state: SequencerReduxState, { awpHandle }) => ({
      ...state,
      awpHandle,
    }),
  }),
  SET_ACTIVE_BEATS: buildActionGroup({
    actionCreator: (activeBeats: { voiceIx: number; beatIx: number }[]) => ({
      type: 'SET_ACTIVE_BEATS',
      activeBeats,
    }),
    subReducer: (state: SequencerReduxState, { activeBeats }) => {
      const newActiveBeats = [...state.activeBeats];
      activeBeats.forEach(
        ({ voiceIx, beatIx }) => (newActiveBeats[voiceIx] = beatIx % state.marks[0]!.length)
      );

      return {
        ...state,
        activeBeats: newActiveBeats,
      };
    },
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
      sampleBank:
        state.sampleBank === 'LOADING'
          ? ('LOADING' as const)
          : { ...state.sampleBank, [voiceIx]: { descriptor, buffer: sampleData } },
    }),
  }),
  SET_SAMPLES: buildActionGroup({
    actionCreator: (sampleBank: Exclude<SequencerReduxState['sampleBank'], string>) => ({
      type: 'SET_SAMPLES',
      sampleBank,
    }),
    subReducer: (state: SequencerReduxState, { sampleBank }) => ({ ...state, sampleBank }),
  }),
  SET_CURRENTLY_EDITING_VOICE_IX: buildActionGroup({
    actionCreator: (voiceIx: number) => ({ type: 'SET_CURRENTLY_EDITING_VOICE_IX', voiceIx }),
    subReducer: (state: SequencerReduxState, { voiceIx }) => {
      const voice = state.voices[voiceIx];
      // Play a single beat of the voice now if the sequencer isn't currently playing
      if (!state.isPlaying) {
        SequencerBeatPlayerByVoiceType[voice.type](state, voiceIx, voice as any);
      }

      return {
        ...state,
        currentEditingVoiceIx: voiceIx,
      };
    },
  }),
  TOGGLE_EDIT_MODE: buildActionGroup({
    actionCreator: (voiceIx: number, beatIx?: number) => ({
      type: 'TOGGLE_EDIT_MODE',
      voiceIx,
      beatIx,
    }),
    subReducer: (state: SequencerReduxState, { voiceIx, beatIx }) => {
      const voice = state.voices[voiceIx];
      if (voice.type !== 'midi') {
        console.error('Tried to toggle editing state on non-MIDI voice');
        return state;
      }

      const firstMarkedBeatIx = state.marks[voiceIx].findIndex(R.identity);
      return {
        ...state,
        markEditState:
          state.markEditState?.voiceIx === voiceIx &&
          (R.isNil(beatIx) || state.markEditState?.editingMarkIx === beatIx)
            ? null
            : {
                voiceIx,
                editingMarkIx: beatIx ?? (firstMarkedBeatIx === -1 ? null : firstMarkedBeatIx),
              },
      };
    },
  }),
  SET_MARK_STATE: buildActionGroup({
    actionCreator: (markState: SequencerMark, advanceSelectedMark?: boolean) => ({
      type: 'SET_MARK_STATE',
      markState,
      advanceSelectedMark,
    }),
    subReducer: (state: SequencerReduxState, { markState, advanceSelectedMark }) => {
      if (R.isNil(state.markEditState?.editingMarkIx)) {
        console.warn('Tried to set mark state with no editing mark selected');
        return state;
      }

      const getNextMarkIndex = (
        curMarkIndex: number,
        marks: (SequencerMark | null)[]
      ): number | null => {
        const nextMarkIx = marks.findIndex((mark, i) => i > curMarkIndex && !!mark);
        if (nextMarkIx !== -1) {
          return nextMarkIx;
        }

        const firstMarkIx = marks.findIndex(mark => !!mark);
        return firstMarkIx === -1 ? null : firstMarkIx;
      };

      return {
        ...state,
        marks: R.set(
          R.lensPath([state.markEditState!.voiceIx, state.markEditState!.editingMarkIx!]),
          markState,
          state.marks
        ),
        markEditState: advanceSelectedMark
          ? {
              voiceIx: state.markEditState!.voiceIx,
              editingMarkIx: getNextMarkIndex(
                state.markEditState!.editingMarkIx!,
                state.marks[state.markEditState!.voiceIx]
              ),
            }
          : state.markEditState,
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

const DEFAULT_WIDTH = 32 as const;

export const buildSequencerInputMIDINode = (vcId: string): MIDINode => {
  const inputCbs: MIDIInputCbs = {
    onAttack: (note, velocity, _offset) => {
      const reduxInfra = SequencerReduxInfraMap.get(vcId);
      const state = reduxInfra?.getState();
      if (R.isNil(state?.sequencer.markEditState?.editingMarkIx)) {
        return;
      }

      const newMark = { type: 'midi' as const, note, gain: velocity };
      reduxInfra!.dispatch(reduxInfra!.actionCreators.sequencer.SET_MARK_STATE(newMark, true));

      // Play a single beat of the voice now if the sequencer isn't currently playing
      if (!state!.sequencer.isPlaying) {
        const voiceIx = state!.sequencer.markEditState!.voiceIx;
        const voice = state!.sequencer.voices[voiceIx];
        SequencerBeatPlayerByVoiceType[voice.type](
          state!.sequencer,
          voiceIx,
          voice as any,
          newMark as any
        );
      }
    },
    onRelease: () => void 0,
    onClearAll: () => void 0,
    onPitchBend: () => void 0,
  };

  return buildMIDINode(() => inputCbs);
};

export const buildInitialState = (vcId: string): SequencerReduxState => ({
  currentEditingVoiceIx: 0,
  activeBeats: [0],
  voices: [{ type: 'sample' as const }],
  sampleBank: {},
  marks: [R.times(() => null, DEFAULT_WIDTH)],
  bpm: 80,
  isPlaying: false,
  outputGainNode: new GainNode(ctx),
  midiOutputs: [],
  gateOutputs: [],
  schedulerScheme: SchedulerScheme.Stable,
  awpHandle: undefined,
  inputMIDINode: buildSequencerInputMIDINode(vcId),
  markEditState: null,
});
