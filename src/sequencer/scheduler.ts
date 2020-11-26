import * as R from 'ramda';

import { SequencerReduxState, VoiceTarget } from 'src/sequencer/redux';
import { scheduleEvent } from 'src/eventScheduler';

const ctx = new AudioContext();

type BeatSchedulerBuilder<K extends string> = (
  state: SequencerReduxState,
  voiceIx: number,
  voice: Extract<VoiceTarget, { type: K }>
) => void;

export const BeatSchedulersBuilderByVoiceType: {
  [K in VoiceTarget['type']]: BeatSchedulerBuilder<K>;
} = {
  midi: (
    state: SequencerReduxState,
    _voiceIx: number,
    voice: Extract<VoiceTarget, { type: 'midi' }>
  ) => {
    if (R.isNil(voice.synthIx)) {
      return;
    }

    const midiOutput = state.midiOutputs[voice.synthIx!];
    if (!midiOutput) {
      throw new Error(`No MIDI output at index ${voice.synthIx} found in sequencer state`);
    }

    midiOutput.outputCbs.forEach(({ onAttack, onRelease }) => {
      // TODO: Make per-voice config of what percentage of the window to hold the note for
      const beatDurationMS = (60 / state.bpm) * 1000;
      const holdDurationMS = beatDurationMS * 0.72;

      onAttack(voice.note, 0, 255);
      scheduleEvent(ctx.currentTime + holdDurationMS / 1000, () => onRelease(voice.note, 0, 255));
    });
  },
  sample: (
    state: SequencerReduxState,
    voiceIx: number,
    _voice: Extract<VoiceTarget, { type: 'sample' }>
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
    voice: Extract<VoiceTarget, { type: 'gate' }>
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
    dstGate.offset.setValueAtTime(0.0, ctx.currentTime + holdDurationMS / 1000);
  },
};
