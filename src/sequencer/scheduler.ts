import * as R from 'ramda';
import { Option } from 'funfix-core';

import { SequencerReduxState, VoiceTarget } from 'src/sequencer/redux';
import { getBeatTimings } from 'src/sequencer/sequencer';
import { UnreachableException, UnimplementedError } from 'ameo-utils';

const ctx = new AudioContext();

export type SchedulerHandle = number;

const RESCHEDULE_INTERVAL_MS = 1000;

interface SchedulerState {
  /**
   * Samples that have been scheduled to be played.  We hold onto them until the next scheduler
   * quantum in case they need to be canceled due to the sequencer being stopped.
   */
  scheduledBuffers: { time: number; node: AudioBufferSourceNode }[];
}

const BeatSchedulersBuilderByVoiceType: {
  [K in VoiceTarget['type']]: (
    state: SequencerReduxState,
    schedulerState: SchedulerState,
    voice: Extract<VoiceTarget, { type: K }>
  ) => (beat: number) => void;
} = {
  midi: (
    state: SequencerReduxState,
    _schedulerState: SchedulerState,
    voice: Extract<VoiceTarget, { type: 'midi' }>
  ) => {
    if (R.isNil(voice.synthIx)) {
      return R.identity;
    }

    return (beat: number) => {
      state.midiOutputs[voice.synthIx!].outputCbs.forEach(({ onAttack, onRelease }) => {
        const curTime = ctx.currentTime;
        // TODO: Make per-voice config of what percentage of the window to hold the note for
        const beatDurationMS = (state.bpm * 1000) / 60;
        const holdDurationMS = beatDurationMS * 0.72;

        onAttack(voice.note, 0, 255, beat - curTime);
        onRelease(voice.note, 0, 255, beat + holdDurationMS / 1000 - curTime);
      });
    };
  },
  sample: (
    state: SequencerReduxState,
    schedulerState: SchedulerState,
    voice: Extract<VoiceTarget, { type: 'sample' }>
  ) => {
    if (R.isNil(voice.sampleIx)) {
      return R.identity;
    }

    const buffer = state.sampleBank[voice.sampleIx!].buffer;

    return (time: number) => {
      const node = new AudioBufferSourceNode(ctx, { buffer });
      node.start(time);
      schedulerState.scheduledBuffers.push({ time, node });
      // TODO: Connect node to internal bus node
      throw new UnimplementedError();
    };
  },
};

const mkBeatScheduler = (
  state: SequencerReduxState,
  schedulerState: SchedulerState,
  voice: VoiceTarget
) => BeatSchedulersBuilderByVoiceType[voice.type](state, schedulerState, voice as any);

const SchedulerStateMap: Map<SchedulerHandle, SchedulerState> = new Map();

export const initScheduler = (state: SequencerReduxState): SchedulerHandle => {
  let lastScheduledTime = ctx.currentTime - RESCHEDULE_INTERVAL_MS / 1000;
  let lastScheduledBeat = -1;

  const schedulerState: SchedulerState = {
    scheduledBuffers: [],
  };

  const handle = setInterval(() => {
    const curTime = ctx.currentTime;
    const endOfCurSchedWindow = lastScheduledTime + RESCHEDULE_INTERVAL_MS / 1000;
    lastScheduledTime = curTime;

    // Drop references to all samples that have already been started
    schedulerState.scheduledBuffers = schedulerState.scheduledBuffers.filter(
      ({ time }) => time > curTime
    );

    const beatCountEstimate = Math.max(((RESCHEDULE_INTERVAL_MS / 1000) * 60) / state.bpm, 1);
    let beatTimings = getBeatTimings(
      state.schedulerScheme,
      state.bpm,
      lastScheduledBeat + 1,
      lastScheduledBeat + beatCountEstimate + 1
    );

    // make sure that we have timings for all necessary beats
    while (R.last(beatTimings)! < endOfCurSchedWindow) {
      beatTimings = [
        ...beatTimings,
        ...getBeatTimings(
          state.schedulerScheme,
          state.bpm,
          lastScheduledBeat + 1 + beatTimings.length,
          lastScheduledBeat + beatCountEstimate + 1 + beatTimings.length
        ),
      ];
    }

    beatTimings = beatTimings.filter(beat => beat > curTime && beat < endOfCurSchedWindow);
    lastScheduledBeat = Option.of(R.last(beatTimings)).getOrElse(lastScheduledBeat);

    state.voices.forEach(voice =>
      beatTimings.forEach(mkBeatScheduler(state, schedulerState, voice))
    );
  }, RESCHEDULE_INTERVAL_MS);

  SchedulerStateMap.set(handle, schedulerState);
  return handle;
};

export const stopScheduler = (handle: SchedulerHandle, state: SequencerReduxState) => {
  // TODO: Clear all scheduled events for all voices
  const schedulerState = SchedulerStateMap.get(handle);
  if (!schedulerState) {
    throw new UnreachableException(
      `No entry in scheduler state map for handle ${handle} when stopping scheduler`
    );
  }
  SchedulerStateMap.delete(handle);

  // Cancel all pending samples
  schedulerState.scheduledBuffers.forEach(({ node }) => node.stop());

  // Cancel all pending MIDI events
  state.voices
    .filter(voice => voice.type === 'midi')
    .forEach(midiVoice => {
      const synthIx = (midiVoice as Extract<VoiceTarget, { type: 'midi' }>).synthIx;
      if (!R.isNil(synthIx)) {
        state.midiOutputs[synthIx!].outputCbs.forEach(({ onClearAll }) => onClearAll());
      }
    });

  clearInterval(handle);
};
