import Synth from 'tone/Tone/instrument/Synth';
import * as R from 'ramda';

class PolySynth {
  constructor(voiceCount: number) {
    this.voices = R.times(R.identity, voiceCount).map(() =>
      new Synth({ envelope: { release: 0.1 } }).toMaster()
    );
  }

  voices: Synth[];
}

const SYNTHS: PolySynth[] = [];

export const init_synth = (voiceCount: number): number => {
  const synth = new PolySynth(voiceCount);
  return SYNTHS.push(synth) - 1;
};

export const trigger_attack = (synthIx: number, voiceIx: number, frequency: number) =>
  SYNTHS[synthIx].voices[voiceIx].triggerAttack(frequency);

export const trigger_release = (synthIx: number, voiceIx: number) =>
  SYNTHS[synthIx].voices[voiceIx].triggerRelease();

export const schedule_events = (
  synthIx: number,
  scheduledEvents: Uint8ClampedArray,
  frequencies: Float32Array,
  eventTimings: Float32Array
) => {
  let consumedFrequencies = 0;
  for (let i = 0; i < eventTimings.length; i += 1) {
    const [isAttack, voiceIx] = [scheduledEvents[i * 2] == 1, scheduledEvents[i * 2 + 1]];
    const time = eventTimings[i];
    const voice = SYNTHS[synthIx].voices[voiceIx];

    if (isAttack) {
      const frequency = frequencies[consumedFrequencies];
      consumedFrequencies += 1;
      voice.triggerAttack(frequency, '+' + time);
    } else {
      voice.triggerRelease('+' + time);
    }
  }
};
