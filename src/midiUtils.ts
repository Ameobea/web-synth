const A0_MIDI_NUMBER = 21;
const NOTES = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab'];
const MIDI_NUMBERS_PER_OCTAVE = NOTES.length;

export const midiNumberToNoteName = (midiNumber: number): string => {
  const octaveNumber = Math.floor((midiNumber - A0_MIDI_NUMBER) / MIDI_NUMBERS_PER_OCTAVE);
  const noteIx = (midiNumber + 12 * 199 - A0_MIDI_NUMBER) % MIDI_NUMBERS_PER_OCTAVE;
  return `${NOTES[noteIx]}${octaveNumber}`;
};
