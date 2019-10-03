import React, { useEffect, useRef } from 'react';
import * as R from 'ramda';

import { midiToFrequency } from 'src/util';

const START_NOTE = 33;

const keys = ['z', 's', 'x', 'c', 'f', 'v', 'g', 'b', 'n', 'j', 'm', 'k', ',', 'l', '.', '/'];

const keyMap: { [key: string]: number } = keys.reduce(
  (acc, key, i) => ({ ...acc, [key]: START_NOTE + i }),
  {}
);

// // Add in missing WebMIDI types to global scope
// declare global {
//   interface Navigator {
//     requestMIDIAccess: () => Promise<unknown>;
//   }
// }

// declare interface MIDIInput {

// }

// declare interface MIDIOutputMap extends Iterable<MIDIInput> {}

// declare interface MIDIAccess {
//   sysexEnabled: boolean;
//   outputs: MIDIOutputMap;
//   inputs: MIDIOutputMap;
//   onstatechange: null | ((evt: unknown) => void);
// }

const tryInitMidi = async (
  playNote: (midiNumber: number, velocity: number) => void,
  releaseNote: (midiNumber: number, velocity: number) => void
) => {
  if (!navigator.requestMIDIAccess) {
    throw new Error(
      "Unable to initialize MIDI; no keyboard attached or browser doesn't support it"
    );
  }

  const access = await navigator.requestMIDIAccess();

  for (const [_id, input] of access.inputs) {
    if (!input.name.includes('KeyStep')) {
      continue;
    }

    const midiModule = await import('../midi');

    const ctxPtr = midiModule.create_msg_handler_context(playNote, releaseNote);

    input.addEventListener('midimessage', evt => midiModule.handle_midi_evt(evt.data, ctxPtr));
    break;
  }
};

const MidiKeyboard: React.FC<{
  playNote: (frequency: number) => void;
  releaseNote: (frequency: number) => void;
}> = ({ playNote, releaseNote }) => {
  const midiAccess = useRef<MidiPermissionDescriptor | null | 'INITIALIZING' | 'INIT_FAILED'>(null);

  useEffect(() => {
    if (!midiAccess.current) {
      midiAccess.current = 'INITIALIZING';
      tryInitMidi(
        (midiNumber: number, velocity: number) => playNote(midiToFrequency(midiNumber)),
        (midiNumber: number, velocity: number) => releaseNote(midiToFrequency(midiNumber))
      )
        .then(access => {
          midiAccess.current = access;
        })
        .catch(err => {
          console.warn(err);
          midiAccess.current = 'INIT_FAILED';
        });
    }

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
