import React, { useEffect, useRef } from 'react';
import * as R from 'ramda';

import { midiToFrequency } from 'src/util';

const START_NOTE = 33;

const keys = ['z', 's', 'x', 'c', 'f', 'v', 'g', 'b', 'n', 'j', 'm', 'k', ',', 'l', '.', '/'];

const keyMap: { [key: string]: number } = keys.reduce(
  (acc, key, i) => ({ ...acc, [key]: START_NOTE + i }),
  {}
);

declare interface MIDIInput extends EventTarget {
  name: string;
}

declare type MIDIOutputMap = Iterable<[string, MIDIInput]>;

declare interface MIDIAccess {
  sysexEnabled: boolean;
  outputs: MIDIOutputMap;
  inputs: MIDIOutputMap;
  onstatechange: null | ((evt: unknown) => void);
}

// // Add in missing WebMIDI types to global scope
declare global {
  interface Navigator {
    requestMIDIAccess: () => Promise<MIDIAccess>;
  }
}

const tryInitMidi = async (
  playNote: (voiceIx: number, frequency: number, velocity: number) => void,
  releaseNote: (voiceIx: number, frequency: number, velocity: number) => void,
  handlePitchBend?: null | ((lsb: number, msb: number) => void)
): Promise<MIDIAccess> => {
  if (!navigator.requestMIDIAccess) {
    throw new Error(
      "Unable to initialize MIDI; no keyboard attached or browser doesn't support it"
    );
  }

  const access = await navigator.requestMIDIAccess();

  for (const [, input] of access.inputs) {
    if (!input.name.includes('KeyStep')) {
      continue;
    }

    const midiModule = await import('../midi');

    const ctxPtr = midiModule.create_msg_handler_context(playNote, releaseNote, handlePitchBend);

    input.addEventListener('midimessage', (evt: Event & { data: Uint8Array }) =>
      midiModule.handle_midi_evt(evt.data, ctxPtr)
    );
    break;
  }

  return access;
};

const MidiKeyboard: React.FC<{
  playNote: (voiceIx: number, frequency: number, velocity: number) => void;
  releaseNote: (voiceIx: number, frequency: number, velocity: number) => void;
  handlePitchBend?: ((lsb: number, msb: number) => void) | null;
}> = ({ playNote, releaseNote, handlePitchBend }) => {
  const midiAccess = useRef<MIDIAccess | null | 'INITIALIZING' | 'INIT_FAILED'>(null);

  useEffect(() => {
    if (!midiAccess.current) {
      midiAccess.current = 'INITIALIZING';
      tryInitMidi(playNote, releaseNote, handlePitchBend)
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

      playNote(0, midiToFrequency(midiNumber), 255);
    };
    const handleUp = (evt: KeyboardEvent) => {
      const midiNumber = keyMap[evt.key];
      if (R.isNil(midiNumber)) {
        return;
      }

      releaseNote(0, midiToFrequency(midiNumber), 255);
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
