import React, { useEffect } from 'react';
import * as R from 'ramda';

import { midiToFrequency } from 'src/util';

const START_NOTE = 33;

const keys = ['z', 's', 'x', 'c', 'f', 'v', 'g', 'b', 'n', 'j', 'm', 'k', ',', 'l', '.', '/'];

const keyMap: { [key: string]: number } = keys.reduce(
  (acc, key, i) => ({ ...acc, [key]: START_NOTE + i }),
  {}
);

const MidiKeyboard: React.FC<{
  playNote: (frequency: number) => void;
  releaseNote: (frequency: number) => void;
}> = ({ playNote, releaseNote }) => {
  useEffect(() => {
    const handleDown = (evt: KeyboardEvent) => {
      const midiNumber = keyMap[evt.key];
      if (R.isNil(midiNumber)) {
        return;
      }

      playNote(midiToFrequency(midiNumber));
    };
    const handleUp = (evt: KeyboardEvent) => {
      const midiNumber = keyMap[evt.key];
      if (R.isNil(midiNumber)) {
        return;
      }

      releaseNote(midiToFrequency(midiNumber));
    };

    document.addEventListener('keydown', handleDown);
    document.addEventListener('keyup', handleUp);

    return () => {
      document.removeEventListener('keydown', handleDown);
      document.removeEventListener('keyup', handleUp);
    };
  });

  return null;
};

export default MidiKeyboard;
