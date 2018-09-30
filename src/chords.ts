import * as R from 'ramda';
import * as _Tone from 'tone';
import * as tonal from 'tonal';
import { transpose } from 'tonal-distance';

export const Tone = _Tone;
export const synth = new Tone.PolySynth(4, Tone.Synth).toMaster();
(window as any).Tone = Tone;
(window as any).SYNTH = synth;
(window as any).tonal = tonal;

Tone.Master.volume.value = -24;

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

export const main = (engine: typeof import('./engine')) => {
  engine.init();

  const baseNotes = ['A4', 'A5', 'G4', 'B6', 'C7', 'E7'];

  const intervals = tonal.Interval.names('d');
  const chords = R.range(1, 7)
    .map(i => [{ notes: transposeChord(`${intervals[i]}${i}`, baseNotes), beats: 8 }, rest(4)])
    .reverse();
  // playChords(60, [{ notes: baseNotes, beats: 16 }, rest(4), ...R.unnest(chords)]);

  // const c = (notes: Note[]): Chord => ({ notes, beats: 8 });
  // playChords(60, [
  //   c(['A4', 'A5', 'G4', 'B6', 'C7', 'E7']),
  //   c(['G#4', 'G#5', 'D#6', 'F#6', 'A#7', 'B7', 'D#7']),
  // ]);
};
