import { buildActionGroup, buildModule, buildStore } from 'jantix';
import * as R from 'ramda';

import { setConnectionFlowingStatus } from 'src/graphEditor/GraphEditor';
import { MIDINode, type MIDIInputCbs } from 'src/patchNetwork/midiNode';
import type { SampleDescriptor } from 'src/sampleLibrary';
import { buildGateOutput } from 'src/sequencer';
import { SequencerBeatPlayerByVoiceType } from 'src/sequencer/scheduler';

export type VoiceTarget =
  | {
      type: 'sample';
      gain: number;
    }
  | {
      type: 'midi';
      synthIx: number | null;
    }
  | {
      type: 'gate';
      gateIx: number | null;
      outputValue: number;
      ungate: boolean;
    };

export enum SchedulerScheme {
  Stable,
  Swung,
  Random,
}

export type SequencerMark =
  | { type: 'sample'; params: { gain: number } | null }
  | { type: 'midi'; note: number }
  | { type: 'gate'; params: { outputValue: number; ungate: boolean } | null };

const buildDefaultSequencerMark = (voice: VoiceTarget): SequencerMark => {
  switch (voice.type) {
    case 'sample':
      return { type: 'sample', params: null };
    case 'midi':
      return { type: 'midi', note: 60 };
    case 'gate':
      return { type: 'gate', params: null };
  }
};

export interface SequencerEditState {
  voiceIx: number;
  editingMarkIx: number | null;
}

export interface SequencerReduxState {
  currentEditingVoiceIx: number;
  activeBeats: number[];
  voices: (VoiceTarget & { name: string })[];
  sampleBank:
    | { [voiceIx: number]: { descriptor: SampleDescriptor; buffer: AudioBuffer } | null }
    | 'LOADING';
  /**
   * For each voice, an array of the indices of all marked cells for that voice/row
   */
  marks: { marks: (SequencerMark | null)[]; rowID: string }[];
  bpm: number;
  isPlaying: boolean;
  outputGainNode: GainNode;
  midiOutputs: MIDINode[];
  gateOutputs: ConstantSourceNode[];
  schedulerScheme: SchedulerScheme;
  awpHandle: AudioWorkletNode | undefined;
  inputMIDINode: MIDINode;
  markEditState: SequencerEditState | null;
  curActiveMarkIx: number | null;
}

const ctx = new AudioContext();

interface SequencerVoiceAWPConfig {
  marks: boolean[];
}

interface SequencerAWPConfig {
  beatCount: number;
  beatRatio: number;
  voices: SequencerVoiceAWPConfig[];
}

export const buildSequencerConfig = (state: SequencerReduxState): SequencerAWPConfig => {
  return {
    beatCount: state.marks[0]!.marks.length,
    beatRatio: 0.25,
    voices: state.marks.map(marks => ({ marks: marks.marks.map(mark => !!mark) })),
  };
};

const reschedule = (state: SequencerReduxState): SequencerReduxState => {
  if (!state.awpHandle) {
    return state;
  }

  state.awpHandle.port.postMessage({ type: 'configure', config: buildSequencerConfig(state) });

  return state;
};

interface SequencerInst extends SequencerReduxInfra {
  onGlobalStart: (startBeat: number) => void;
  onGlobalStop: () => void;
}

export const SequencerInstancesMap: Map<string, SequencerInst> = new Map();

(window as any).getSequencer = () => {
  if (SequencerInstancesMap.size === 1) {
    return SequencerInstancesMap.get([...SequencerInstancesMap.keys()][0]);
  }
  return SequencerInstancesMap;
};

const actionGroups = {
  SET_STATE: buildActionGroup({
    actionCreator: (newState: SequencerReduxState) => ({ type: 'SET_STATE', newState }),
    subReducer: (_state: SequencerReduxState, { newState }) => newState,
  }),
  ADD_VOICE: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_VOICE' }),
    subReducer: (state: SequencerReduxState) =>
      reschedule({
        ...state,
        marks: [
          ...state.marks,
          { marks: R.times(() => null, state.marks[0]!.marks.length), rowID: genRandomStringID() },
        ],
        voices: [...state.voices, { type: 'sample' as const, name: 'sample', gain: 1 }],
      }),
  }),
  REMOVE_VOICE: buildActionGroup({
    actionCreator: (voiceIx: number) => ({ type: 'REMOVE_VOICE', voiceIx }),
    subReducer: (state: SequencerReduxState, { voiceIx }) => {
      // Always must have at least one voice
      if (state.marks.length === 1) {
        return state;
      }

      return reschedule({
        ...state,
        marks: R.remove(voiceIx, 1, state.marks),
      });
    },
  }),
  MARK: buildActionGroup({
    actionCreator: (rowIx: number, colIx: number) => ({ type: 'MARK', rowIx, colIx }),
    subReducer: (state: SequencerReduxState, { rowIx, colIx }) =>
      reschedule({
        ...state,
        marks: R.set(
          R.lensPath([rowIx, 'marks', colIx]),
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
        marks: R.set(R.lensPath([rowIx, 'marks', colIx]), null, state.marks),
        markEditState:
          state.markEditState?.voiceIx === rowIx && state.markEditState?.editingMarkIx === colIx
            ? null
            : state.markEditState,
      }),
  }),
  TOGGLE_IS_PLAYING: buildActionGroup({
    actionCreator: (vcId: string, startBeat?: number) => ({
      type: 'TOGGLE_IS_PLAYING',
      vcId,
      startBeat,
    }),
    subReducer: (state: SequencerReduxState, { vcId, startBeat }) => {
      if (!state.awpHandle) {
        return state;
      }

      setConnectionFlowingStatus(vcId, 'output', !state.isPlaying);

      if (state.isPlaying) {
        state.awpHandle.port.postMessage({ type: 'stop' });
        return { ...state, isPlaying: false, curActiveMarkIx: null };
      } else {
        state.awpHandle.port.postMessage({ type: 'start', startBeat: startBeat ?? 0 });
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
      voices: R.set(
        R.lensIndex(voiceIx),
        { ...newTarget, name: state.voices[voiceIx].name },
        state.voices
      ),
      marks:
        newTarget.type !== state.voices[voiceIx].type
          ? R.set(
              R.lensIndex(voiceIx),
              {
                ...state.marks[voiceIx],
                marks: state.marks[voiceIx].marks.map(mark =>
                  mark ? buildDefaultSequencerMark(newTarget) : null
                ),
              },
              state.marks
            )
          : state.marks,
    }),
  }),
  ADD_MIDI_OUTPUT: buildActionGroup({
    actionCreator: () => ({ type: 'ADD_MIDI_OUTPUT' }),
    subReducer: (state: SequencerReduxState) => ({
      ...state,
      midiOutputs: [...state.midiOutputs, new MIDINode()],
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
      removed.inputCbs.onClearAll();

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
        ({ voiceIx, beatIx }) => (newActiveBeats[voiceIx] = beatIx % state.marks[0]!.marks.length)
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
      const firstMarkedBeatIx = state.marks[voiceIx].marks.findIndex(R.identity);
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
          R.lensPath([state.markEditState!.voiceIx, 'marks', state.markEditState!.editingMarkIx!]),
          markState,
          state.marks
        ),
        markEditState: advanceSelectedMark
          ? {
              voiceIx: state.markEditState!.voiceIx,
              editingMarkIx: getNextMarkIndex(
                state.markEditState!.editingMarkIx!,
                state.marks[state.markEditState!.voiceIx].marks
              ),
            }
          : state.markEditState,
      };
    },
  }),
  SET_BEAT_COUNT: buildActionGroup({
    actionCreator: (beatCount: number) => ({ type: 'SET_BEAT_COUNT', beatCount }),
    subReducer: (state: SequencerReduxState, { beatCount }) => {
      const curMarkCount = state.marks[0].marks.length;
      if (curMarkCount === beatCount) {
        return state;
      } else if (curMarkCount < beatCount) {
        const newMarks = state.marks.map(row => ({
          ...row,
          marks: [...row.marks, ...new Array(beatCount - curMarkCount).fill(null)],
        }));
        return reschedule({ ...state, marks: newMarks });
      } else {
        const newMarks = state.marks.map(row => ({ ...row, marks: row.marks.slice(0, beatCount) }));
        return reschedule({ ...state, marks: newMarks });
      }
    },
  }),
  SET_CUR_ACTIVE_MARK_IX: buildActionGroup({
    actionCreator: (curActiveMarkIx: number | null) => ({
      type: 'SET_CUR_ACTIVE_MARK_IX',
      curActiveMarkIx,
    }),
    subReducer: (state: SequencerReduxState, { curActiveMarkIx }) => ({
      ...state,
      curActiveMarkIx,
    }),
  }),
  SET_VOICE_NAME: buildActionGroup({
    actionCreator: (voiceIx: number, name: string) => ({ type: 'SET_VOICE_NAME', voiceIx, name }),
    subReducer: (state: SequencerReduxState, { voiceIx, name }) => ({
      ...state,
      voices: R.set(R.lensIndex(voiceIx), { ...state.voices[voiceIx], name }, state.voices),
    }),
  }),
};

export const buildSequencerReduxInfra = (initialState: SequencerReduxState, vcId: string) => {
  const modules = {
    sequencer: buildModule<SequencerReduxState, typeof actionGroups>(initialState, actionGroups),
  };

  return { ...buildStore<typeof modules>(modules), vcId };
};

export type SequencerReduxInfra = ReturnType<typeof buildSequencerReduxInfra>;

const DEFAULT_WIDTH = 32 as const;

export const buildSequencerInputMIDINode = (vcId: string): MIDINode => {
  const inputCbs: MIDIInputCbs = {
    onAttack: (note, velocity) => {
      const reduxInfra = SequencerInstancesMap.get(vcId);
      const state = reduxInfra?.getState()?.sequencer;
      if (
        !state ||
        !state.markEditState ||
        R.isNil(state.markEditState.editingMarkIx) ||
        state.voices[state.markEditState.editingMarkIx].type !== 'midi'
      ) {
        return;
      }

      const newMark = { type: 'midi' as const, note, gain: velocity };
      reduxInfra!.dispatch(reduxInfra!.actionCreators.sequencer.SET_MARK_STATE(newMark, true));

      // Play a single beat of the voice now if the sequencer isn't currently playing
      if (!state!.isPlaying) {
        const voiceIx = state!.markEditState!.voiceIx;
        const voice = state!.voices[voiceIx];
        SequencerBeatPlayerByVoiceType[voice.type](state!, voiceIx, voice as any, newMark as any);
      }
    },
    onRelease: () => void 0,
    onClearAll: () => void 0,
    onPitchBend: () => void 0,
  };

  return new MIDINode(() => inputCbs);
};

export const buildInitialState = (vcId: string): SequencerReduxState => ({
  currentEditingVoiceIx: 0,
  activeBeats: [0],
  voices: [{ type: 'sample' as const, name: 'sample', gain: 1 }],
  sampleBank: {},
  marks: [{ marks: R.times(() => null, DEFAULT_WIDTH), rowID: genRandomStringID() }],
  bpm: 80,
  isPlaying: false,
  outputGainNode: new GainNode(ctx),
  midiOutputs: [],
  gateOutputs: [],
  schedulerScheme: SchedulerScheme.Stable,
  awpHandle: undefined,
  inputMIDINode: buildSequencerInputMIDINode(vcId),
  markEditState: null,
  curActiveMarkIx: null,
});
