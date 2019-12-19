import React, { useEffect, useMemo, useState, useRef } from 'react';
import * as R from 'ramda';
import { createSelector } from 'reselect';

import Loading from 'src/misc/Loading';
import { midiNodesByStateKey } from 'src/midiKeyboard';
import { useSelector, ReduxStore, dispatch, actionCreators } from 'src/redux';
import { useOnce } from 'ameo-utils/dist/util/react';

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

// Add in missing WebMIDI types to global scope
declare global {
  interface Navigator {
    requestMIDIAccess: () => Promise<MIDIAccess>;
  }
}

const MidiKeyboard: React.FC<{
  playNote: (voiceIx: number, note: number, velocity: number) => void;
  releaseNote: (voiceIx: number, note: number, velocity: number) => void;
  handlePitchBend?: ((lsb: number, msb: number) => void) | null;
}> = ({ playNote, releaseNote }) => {
  const [polySynthMod, setPolySynthMod] = useState<typeof import('src/polysynth') | null>(null);
  const polySynthCtx = useRef<number | null>(null);

  useOnce(() => import('src/polysynth').then(setPolySynthMod));

  useEffect(() => {
    if (!polySynthMod) {
      return;
    }

    polySynthCtx.current = polySynthMod.create_polysynth_context(
      playNote,
      (voiceIx: number, noteId: number) => releaseNote(voiceIx, noteId, 0)
    );

    return () => {
      if (polySynthCtx.current !== null) {
        polySynthMod.drop_polysynth_context(polySynthCtx.current);
      }
    };
  }, [polySynthMod, playNote, releaseNote, polySynthCtx]);

  useEffect(() => {
    if (!polySynthMod || polySynthCtx.current === null) {
      return;
    }

    const handleDown = (evt: KeyboardEvent) => {
      // Discard keypresses while control key pressed
      if (evt.ctrlKey) {
        return;
      }

      // Discard duplicate events coming from holding the key down
      if (evt.repeat) {
        return;
      }
      const midiNumber = keyMap[evt.key.toLowerCase()];
      if (R.isNil(midiNumber)) {
        return;
      }

      polySynthMod.handle_note_down(polySynthCtx.current!, midiNumber, 255);
    };
    const handleUp = (evt: KeyboardEvent) => {
      // Sometimes shift is accidentally pressed while releasing which causes a different key in the release event than the down event
      // which causes ghost notes.
      const midiNumber = keyMap[evt.key.toLowerCase()];
      if (R.isNil(midiNumber)) {
        return;
      }

      polySynthMod.handle_note_up(polySynthCtx.current!, midiNumber);
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

const OctaveControl: React.FC<{ value: number; onChange: (newVal: number) => void }> = ({
  value,
  onChange,
}) => (
  <div>
    Octave Offset: {value}
    <br />
    <button onClick={() => onChange(value - 1)}>-</button>
    <button onClick={() => onChange(value + 1)}>+</button>
  </div>
);

const MIDI_NOTES_PER_OCTAVE = 12 as const;

const mkOctaveCountSelector = () =>
  createSelector(
    (state: ReduxStore, stateKey: string) => {
      const instanceState = state.midiKeyboard[stateKey];
      if (!instanceState) {
        throw new Error(
          `Rendered MIDI keyboard with state key ${stateKey} before Redux was populated for it`
        );
      }
      return instanceState;
    },
    instanceState => instanceState.octaveOffset
  );

/**
 * the component that is mounted to render the view context containing the inner `MidiKeyboard` component
 */
export const MidiKeyboardVC: React.FC<{ stateKey: string }> = ({ stateKey }) => {
  const octaveCountSelector = useMemo(() => mkOctaveCountSelector(), []);
  const octaveOffset = useSelector((state: ReduxStore) => octaveCountSelector(state, stateKey));

  const midiNode = useMemo(() => midiNodesByStateKey.get(stateKey), [stateKey]);
  if (!midiNode) {
    return <Loading />;
  }

  return (
    <div>
      <OctaveControl
        value={octaveOffset}
        onChange={(newOctaveOffset: number) =>
          dispatch(actionCreators.midiKeyboard.SET_OCTAVE_OFFSET(stateKey, newOctaveOffset))
        }
      />

      <MidiKeyboard
        playNote={(voiceIx, note, velocity) =>
          midiNode.outputCbs.forEach(cbs =>
            cbs.onAttack(octaveOffset * MIDI_NOTES_PER_OCTAVE + note, voiceIx, velocity)
          )
        }
        releaseNote={(voiceIx, note, velocity) =>
          midiNode.outputCbs.forEach(cbs =>
            cbs.onRelease(octaveOffset * MIDI_NOTES_PER_OCTAVE + note, voiceIx, velocity)
          )
        }
        handlePitchBend={(_lsb: number, msb: number) =>
          midiNode.outputCbs.forEach(cbs => cbs.onPitchBend(msb))
        }
      />
    </div>
  );
};
