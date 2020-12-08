import React, { useEffect, useMemo, useRef } from 'react';
import * as R from 'ramda';
import { createSelector } from 'reselect';

import Loading from 'src/misc/Loading';
import { midiNodesByStateKey } from 'src/midiKeyboard';
import { useSelector, ReduxStore, dispatch, actionCreators } from 'src/redux';
import { MIDINode } from 'src/patchNetwork/midiNode';

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

const MidiKeyboard: React.FC<{ midiNode: MIDINode; octaveOffset: number }> = ({
  midiNode,
  octaveOffset,
}) => {
  const MIDI_NOTES_PER_OCTAVE = 12 as const;
  const alreadyDownNotes = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleDown = (evt: KeyboardEvent) => {
      // Discard keypresses while control key pressed
      if (evt.ctrlKey) {
        return;
      }

      // Discard duplicate events coming from holding the key down
      if (evt.repeat || alreadyDownNotes.current.has(evt.key)) {
        return;
      }
      alreadyDownNotes.current.add(evt.key);
      const midiNumber = keyMap[evt.key.toLowerCase()];
      if (R.isNil(midiNumber)) {
        return;
      }

      midiNode.outputCbs.forEach(cbs =>
        cbs.onAttack(midiNumber + MIDI_NOTES_PER_OCTAVE * octaveOffset, 255)
      );

      // Work around incredibly annoying Firefox functionality where the slash key opens
      // a "quick find" thing and takes focus away from the page
      const isEditing = (['input', 'textarea'] as (string | undefined)[]).includes(
        document.activeElement?.tagName.toLowerCase()
      );
      if (!isEditing) {
        evt.preventDefault();
      }
    };
    const handleUp = (evt: KeyboardEvent) => {
      alreadyDownNotes.current.delete(evt.key);
      // Sometimes shift is accidentally pressed while releasing which causes a different key in the release event than the down event
      // which causes ghost notes.
      const midiNumber = keyMap[evt.key.toLowerCase()];
      if (R.isNil(midiNumber)) {
        return;
      }

      midiNode.outputCbs.forEach(cbs =>
        cbs.onRelease(midiNumber + MIDI_NOTES_PER_OCTAVE * octaveOffset, 255)
      );
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

      <MidiKeyboard octaveOffset={octaveOffset} midiNode={midiNode} />
    </div>
  );
};
