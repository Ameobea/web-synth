import * as R from 'ramda';

import { SequencerMark, SequencerReduxState, VoiceTarget } from 'src/sequencer/redux';
import { scheduleEventTimeAbsolute } from 'src/eventScheduler';
import { getGlobalBpm } from 'src/globalMenu';

const ctx = new AudioContext();

type BeatSchedulerPlayer<K extends string> = (
  state: SequencerReduxState,
  voiceIx: number,
  voice: Extract<VoiceTarget, { type: K }>,
  mark?: Extract<SequencerMark, { type: K }>
) => void;

export const SequencerBeatPlayerByVoiceType: {
  [K in VoiceTarget['type']]: BeatSchedulerPlayer<K>;
} = {
  midi: (
    state: SequencerReduxState,
    _voiceIx: number,
    voice: Extract<VoiceTarget, { type: 'midi' }>,
    mark?: Extract<SequencerMark, { type: 'midi' }>
  ) => {
    if (R.isNil(voice.synthIx)) {
      return;
    }

    const midiOutput = state.midiOutputs[voice.synthIx!];
    if (!midiOutput) {
      throw new Error(`No MIDI output at index ${voice.synthIx} found in sequencer state`);
    }

    // TODO: Make per-voice config of what percentage of the window to hold the note for
    const beatDurationMS = (60 / getGlobalBpm()) * 1000;
    const holdDurationMS = beatDurationMS * 0.72;

    midiOutput.onAttack(mark?.note ?? voice.note, 255);
    scheduleEventTimeAbsolute(ctx.currentTime + holdDurationMS / 1000, () =>
      midiOutput.onRelease(mark?.note ?? voice.note, 255)
    );
  },
  sample: (
    state: SequencerReduxState,
    voiceIx: number,
    _voice: Extract<VoiceTarget, { type: 'sample' }>,
    _mark?: Extract<SequencerMark, { type: 'sample' }>
  ) => {
    if (typeof state.sampleBank === 'string') {
      return;
    }
    const sample = state.sampleBank[voiceIx];
    if (R.isNil(sample)) {
      return;
    }

    const node = new AudioBufferSourceNode(ctx, { buffer: sample.buffer });
    node.start();
    const { outputGainNode } = state;
    node.connect(outputGainNode);
    node.onended = () => node.disconnect(outputGainNode);
  },
  gate: (
    state: SequencerReduxState,
    _voiceIx: number,
    voice: Extract<VoiceTarget, { type: 'gate' }>,
    _mark?: Extract<SequencerMark, { type: 'gate' }>
  ) => {
    if (R.isNil(voice.gateIx)) {
      return;
    }

    const dstGate = state.gateOutputs[voice.gateIx! as number];
    if (!dstGate) {
      throw new Error(`No gate ix ${voice.gateIx} in state, but voice has it`);
    }

    // TODO: Make the duration of the beat that the gate is activated for configurable
    const beatDurationMS = (state.bpm * 1000) / 60;
    const holdDurationMS = beatDurationMS * 0.72;

    dstGate.offset.setValueAtTime(1.0, ctx.currentTime);
    dstGate.offset.setValueAtTime(0.0, ctx.currentTime + holdDurationMS / 1000 - 0.0001);
  },
};
