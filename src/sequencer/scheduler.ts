import * as R from 'ramda';
import { UnreachableException } from 'ameo-utils';
import { Option } from 'funfix-core';

import { SequencerReduxState, VoiceTarget } from 'src/sequencer/redux';
import { getBeatTimings } from 'src/sequencer/sequencer';

const ctx = new AudioContext();

export type SchedulerHandle = number;

const RESCHEDULE_INTERVAL_MS = 3200;

interface SchedulerState {
  /**
   * The list of all timings that have been scheduled so far.  This includes timings that have no
   * notes played due to no marks.
   */
  curScheduledTimings: number[];
  /**
   * Samples that have been scheduled to be played.  We hold onto them until the next scheduler
   * quantum in case they need to be canceled due to the sequencer being stopped.
   */
  scheduledBuffers: { time: number; node: AudioBufferSourceNode }[];
  totalProcessedBeats: number;
}

type BeatSchedulerBuilder<K extends string> = (
  state: SequencerReduxState,
  schedulerState: SchedulerState,
  voiceIx: number,
  voice: Extract<VoiceTarget, { type: K }>
) => (time: number) => void;

const BeatSchedulersBuilderByVoiceType: { [K in VoiceTarget['type']]: BeatSchedulerBuilder<K> } = {
  midi: (
    state: SequencerReduxState,
    _schedulerState: SchedulerState,
    _voiceIx: number,
    voice: Extract<VoiceTarget, { type: 'midi' }>
  ) => {
    if (R.isNil(voice.synthIx)) {
      return R.identity;
    }

    const midiOutput = state.midiOutputs[voice.synthIx!];
    if (!midiOutput) {
      throw new Error(`No MIDI output at index ${voice.synthIx} found in sequencer state`);
    }

    return (beat: number) => {
      midiOutput.outputCbs.forEach(({ onAttack, onRelease }) => {
        const curTime = ctx.currentTime;
        // TODO: Make per-voice config of what percentage of the window to hold the note for
        const beatDurationMS = (state.bpm * 1000) / 60;
        const holdDurationMS = beatDurationMS * 0.72;

        // TODO: Use a polyphonic voice manager here somewhere?
        onAttack(voice.note, 0, 255, beat - curTime);
        onRelease(voice.note, 0, 255, beat + holdDurationMS / 1000 - curTime);
      });
    };
  },
  sample: (
    state: SequencerReduxState,
    schedulerState: SchedulerState,
    voiceIx: number,
    _voice: Extract<VoiceTarget, { type: 'sample' }>
  ) => {
    const sample = state.sampleBank[voiceIx];
    if (R.isNil(sample)) {
      return R.identity;
    }

    const buffer = sample.buffer;

    return (time: number) => {
      const node = new AudioBufferSourceNode(ctx, { buffer });
      node.start(time);
      schedulerState.scheduledBuffers.push({ time, node });
      node.connect(state.outputGainNode);
    };
  },
  gate: (
    state: SequencerReduxState,
    _schedulerState: SchedulerState,
    _voiceIx: number,
    voice: Extract<VoiceTarget, { type: 'gate' }>
  ) => {
    if (R.isNil(voice.gateIx)) {
      return R.identity;
    }

    if (voice.gateIx === 'RISING_EDGE_DETECTOR') {
      return (time: number) => {
        if (!state.risingEdgeDetector) {
          return;
        }

        const param = (state.risingEdgeDetector.parameters as Map<string, AudioParam>).get(
          'input'
        )!;

        param.setValueAtTime(time, 1.0);
        param.setValueAtTime(time + 1 / (1000 * 10), 0.0);
      };
    }

    return (time: number) => {
      const dstGate = state.gateOutputs[voice.gateIx! as number];
      if (!dstGate) {
        throw new Error(`No gate ix ${voice.gateIx} in state, but voice has it`);
      }

      // TODO: Make the duration of the beat that the gate is activated for configurable
      const beatDurationMS = (state.bpm * 1000) / 60;
      const holdDurationMS = beatDurationMS * 0.72;

      dstGate.offset.setValueAtTime(time, 1.0);
      dstGate.offset.setValueAtTime(time + holdDurationMS / 1000, 0.0);
    };
  },
};

export const mkBeatScheduler = (
  state: SequencerReduxState,
  schedulerState: SchedulerState,
  voiceIx: number,
  voice: VoiceTarget
) => BeatSchedulersBuilderByVoiceType[voice.type](state, schedulerState, voiceIx, voice as any);

const SchedulerStateMap: Map<SchedulerHandle, SchedulerState> = new Map();

export const initScheduler = (
  state: SequencerReduxState,
  firstBeatStartTime?: number,
  totalProcessedBeatsOffset = 0
): SchedulerHandle => {
  let endOfLastSchedulingWindow = Option.of(firstBeatStartTime).getOrElse(ctx.currentTime);
  let lastScheduledBeatIndex = -1 + totalProcessedBeatsOffset;

  const schedulerState: SchedulerState = {
    curScheduledTimings: [],
    scheduledBuffers: [],
    totalProcessedBeats: totalProcessedBeatsOffset,
  };

  const schedule = () => {
    const curTime = ctx.currentTime;
    const startOfCurSchedWindow = Math.max(curTime, endOfLastSchedulingWindow);
    const endOfCurSchedWindow = ctx.currentTime + (RESCHEDULE_INTERVAL_MS / 1000) * 3;
    endOfLastSchedulingWindow = endOfCurSchedWindow;

    // Drop references to all samples that have already been started
    schedulerState.scheduledBuffers = schedulerState.scheduledBuffers.filter(
      ({ time }) => time > curTime
    );

    const beatCountEstimate = Math.max(((RESCHEDULE_INTERVAL_MS / 1000) * 60) / state.bpm, 1);
    let beatTimings = getBeatTimings(
      state.schedulerScheme,
      state.bpm,
      lastScheduledBeatIndex + 1,
      lastScheduledBeatIndex + beatCountEstimate + 1
    );

    // make sure that we have timings for all necessary beats
    while (R.last(beatTimings)! < endOfCurSchedWindow) {
      beatTimings = [
        ...beatTimings,
        ...getBeatTimings(
          state.schedulerScheme,
          state.bpm,
          lastScheduledBeatIndex + 1 + beatTimings.length,
          lastScheduledBeatIndex + beatCountEstimate + 1 + beatTimings.length
        ),
      ];
    }

    beatTimings = beatTimings.filter(
      beat => beat > startOfCurSchedWindow && beat < endOfCurSchedWindow
    );
    schedulerState.curScheduledTimings = [
      ...schedulerState.curScheduledTimings.filter(timing => timing > ctx.currentTime),
      ...beatTimings,
    ];

    lastScheduledBeatIndex = lastScheduledBeatIndex + beatTimings.length;

    const sequencerLength = state.marks[0].length;
    state.voices.forEach((voice, voiceIx) =>
      beatTimings
        .filter(
          (_, i) => state.marks[voiceIx][(schedulerState.totalProcessedBeats + i) % sequencerLength]
        )
        .forEach(mkBeatScheduler(state, schedulerState, voiceIx, voice))
    );
    schedulerState.totalProcessedBeats += beatTimings.length;

    // Schedule the beats on the rising edge detector
    beatTimings.forEach(
      mkBeatScheduler(state, schedulerState, -1, { type: 'gate', gateIx: 'RISING_EDGE_DETECTOR' })
    );
  };

  const handle = setInterval(schedule, RESCHEDULE_INTERVAL_MS);
  // Run once immediately
  schedule();

  SchedulerStateMap.set(handle, schedulerState);
  return handle;
};

export const stopScheduler = (
  handle: SchedulerHandle,
  state: SequencerReduxState
): SchedulerState => {
  const schedulerState = SchedulerStateMap.get(handle);
  if (!schedulerState) {
    throw new UnreachableException(
      `No entry in scheduler state map for handle ${handle} when stopping scheduler`
    );
  }
  SchedulerStateMap.delete(handle);

  // Cancel all pending samples
  schedulerState.scheduledBuffers
    .filter(({ time }) => time > ctx.currentTime)
    .forEach(({ node }) => node.stop());

  // Cancel all pending MIDI events
  state.voices
    .filter(voice => voice.type === 'midi')
    .forEach(midiVoice => {
      const synthIx = (midiVoice as Extract<VoiceTarget, { type: 'midi' }>).synthIx;
      if (!R.isNil(synthIx)) {
        state.midiOutputs[synthIx!].outputCbs.forEach(({ onClearAll }) => onClearAll());
      }
    });

  // Cancel all events on the rising edge detector
  const valueParam = (state.risingEdgeDetector?.parameters as Map<string, AudioParam>).get('value');
  if (valueParam) {
    valueParam.cancelScheduledValues(0);
    valueParam.setValueAtTime(0, ctx.currentTime);
  }

  clearInterval(handle);

  return schedulerState;
};
