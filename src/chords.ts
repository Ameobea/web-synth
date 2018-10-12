import * as R from 'ramda';
import Master from 'tone/Tone/core/Master';
import Synth from 'tone/Tone/instrument/Synth';
import PolySynth from 'tone/Tone/instrument/PolySynth';
import * as tonal from 'tonal';
import { transpose } from 'tonal-distance';

export const synth = new PolySynth(4, Synth).toMaster();
(window as any).SYNTH = synth;
(window as any).tonal = tonal;

Master.volume.value = -24;

export const chord = (notes: string[], durationMillis: number) => {
  synth.triggerAttack(notes);
  setTimeout(() => synth.triggerRelease(notes), durationMillis);
};

const notes = tonal.Chord.notes;

type Note = string | number;

interface Chord {
  notes: Note[];
  beats: number;
}

export const chordThen = (chord: Note[], durationMillis: number): Promise<void> =>
  new Promise(f => {
    synth.triggerAttack(chord);
    setTimeout(() => {
      synth.triggerRelease(chord);
      f();
    }, durationMillis);
  });

(window as any).chord = chord;

export const chord02 = R.partial(chord, [['C4', 'E4', 'G4', 'B4']]);
export const chord01 = R.partial(chord, [['Eb4', 'G4', 'Bb4', 'D5']]);

export const playChords = (bpm: number, chords: Chord[]): void => {
  const [chord, ...rest] = chords;
  if (!chord) {
    return;
  }

  chordThen(chord.notes, bpm * chord.beats).then(R.partial(playChords, [bpm, rest]));
};

const rest = (beats: number): Chord => ({ notes: [], beats });

const transposeChord = (transposition: string, notes: string[]): string[] =>
  notes.map(note => transpose(note, transposition));
