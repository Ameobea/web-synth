import MonoSynth from 'tone/Tone/instrument/MonoSynth';
import * as R from 'ramda';

class PolySynth {
  constructor(voiceCount: number) {
    this.voices = R.times(R.identity, voiceCount).map(() => new MonoSynth().toMaster());
  }

  voices: MonoSynth[];
}

const SYNTHS: PolySynth[] = [];

export const init_synth = (voiceCount: number): number => {
  const synth = new PolySynth(voiceCount);
  return SYNTHS.push(synth) - 1;
};

export const trigger_attack = (synthIx: number, voiceIx: number, frequency: number) =>
  console.log('trigger attack', synthIx, voiceIx, frequency) ||
  SYNTHS[synthIx].voices[voiceIx].triggerAttack(frequency);

export const trigger_release = (synthIx: number, voiceIx: number) =>
  console.log('trigger release', synthIx, voiceIx) ||
  SYNTHS[synthIx].voices[voiceIx].triggerRelease();
