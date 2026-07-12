import * as R from 'ramda';

import { scheduleEventTimeAbsolute } from 'src/eventScheduler';
import { getGlobalBpm } from 'src/globalMenu/globalTempo';
import type { SequencerMark, SequencerReduxState, VoiceTarget } from 'src/sequencer/redux';

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

    midiOutput.onAttack(mark?.note ?? (voice as any).note, 90);
    scheduleEventTimeAbsolute(ctx.currentTime + holdDurationMS / 1000, () =>
      midiOutput.onRelease(mark?.note ?? (voice as any).note, 90)
    );
  },
  sample: (
    state: SequencerReduxState,
    voiceIx: number,
    voice: Extract<VoiceTarget, { type: 'sample' }>,
    mark?: Extract<SequencerMark, { type: 'sample' }>
  ) => {
    if (typeof state.sampleBank === 'string') {
      return;
    }
    const sample = state.sampleBank[voiceIx];
    if (R.isNil(sample)) {
      return;
    }

    const { outputGainNode } = state;
    const node = new AudioBufferSourceNode(ctx, { buffer: sample.buffer });
    const gainNode = new GainNode(ctx, { gain: mark?.params?.gain ?? voice.gain ?? 1 });
    node.connect(gainNode);
    gainNode.connect(outputGainNode);
    node.start();
    node.onended = () => {
      node.disconnect(gainNode);
      gainNode.disconnect(outputGainNode);
    };
  },
  gate: (
    state: SequencerReduxState,
    _voiceIx: number,
    voice: Extract<VoiceTarget, { type: 'gate' }>,
    mark?: Extract<SequencerMark, { type: 'gate' }>
  ) => {
    if (R.isNil(voice.gateIx)) {
      return;
    }

    const dstGate = state.gateOutputs[voice.gateIx! as number];
    if (!dstGate) {
      console.error(`No gate ix ${voice.gateIx} in state, but voice has it`);
    }

    // TODO: Make the duration of the beat that the gate is activated for configurable
    const beatDurationMS = (60 / getGlobalBpm()) * 1000;
    const holdDurationMS = beatDurationMS * 0.72;

    dstGate?.offset.setValueAtTime(
      mark?.params?.outputValue ?? voice.outputValue ?? 1.0,
      ctx.currentTime
    );
    const ungate = mark?.params?.ungate ?? voice.ungate ?? true;
    if (ungate !== false) {
      dstGate?.offset.setValueAtTime(0.0, ctx.currentTime + holdDurationMS / 1000 - 0.0001);
    }
  },
};
