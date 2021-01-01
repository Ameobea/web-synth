import React, { useEffect, useMemo, useReducer } from 'react';
import * as R from 'ramda';
import { createSelector } from 'reselect';
import { Piano } from 'react-piano';
import 'react-piano/dist/styles.css';
import { Set as ImmSet } from 'immutable';
import { UnreachableException } from 'ameo-utils';

import Loading from 'src/misc/Loading';
import { midiNodesByStateKey } from 'src/midiKeyboard';
import { useSelector, ReduxStore, dispatch, actionCreators } from 'src/redux';
import './MidiKeyboard.scss';

const MIDI_NOTES_PER_OCTAVE = 12 as const;
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

export const MidiKeyboard: React.FC<{
  octaveOffset: number;
  onOctaveOffsetChange: (newOctaveOffset: number) => void;
  onAttack: (midiNumber: number) => void;
  onRelease: (midiNumber: number) => void;
}> = ({ octaveOffset, onOctaveOffsetChange, onAttack, onRelease }) => {
  const [alreadyDownNotes, setAlreadyDownNotes] = useReducer(
    (
      state: ImmSet<number>,
      action: { type: 'ADD' | 'REMOVE'; midiNumber: number } | { type: 'CLEAR' }
    ) => {
      if (action.type === 'ADD') {
        return state.add(action.midiNumber);
      } else if (action.type === 'REMOVE') {
        return state.remove(action.midiNumber);
      } else if (action.type === 'CLEAR') {
        return ImmSet();
      } else {
        throw new UnreachableException();
      }
    },
    ImmSet()
  );

  const playNote = (midiNumber: number) => {
    // Discard duplicate events coming from holding the key down
    if (alreadyDownNotes.has(midiNumber)) {
      return;
    }
    setAlreadyDownNotes({ type: 'ADD', midiNumber });

    onAttack(midiNumber + MIDI_NOTES_PER_OCTAVE * octaveOffset);
  };

  const releaseNote = (midiNumber: number) => {
    setAlreadyDownNotes({ type: 'REMOVE', midiNumber });
    // Sometimes shift is accidentally pressed while releasing which causes a different key in the release event than the down event
    // which causes ghost notes.

    onRelease(midiNumber + MIDI_NOTES_PER_OCTAVE * octaveOffset);
  };

  const setOctaveOffset = (newOctaveOffset: number) => {
    onOctaveOffsetChange(newOctaveOffset);

    // Release any held notes to avoid them getting stuck
    alreadyDownNotes.forEach(releaseNote);
    setAlreadyDownNotes({ type: 'CLEAR' });
  };

  useEffect(() => {
    const handleDown = (evt: KeyboardEvent) => {
      // Discard keypresses while control key pressed
      if (evt.ctrlKey) {
        return;
      }
      const midiNumber = keyMap[evt.key.toLowerCase()] + octaveOffset * MIDI_NOTES_PER_OCTAVE;
      if (R.isNil(midiNumber)) {
        return;
      } else if (evt.repeat) {
        return;
      }

      playNote(midiNumber);
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
      const midiNumber = keyMap[evt.key.toLowerCase()] + octaveOffset * MIDI_NOTES_PER_OCTAVE;
      if (R.isNil(midiNumber)) {
        return;
      }
      releaseNote(midiNumber);
    };

    document.addEventListener('keydown', handleDown);
    document.addEventListener('keyup', handleUp);

    return () => {
      document.removeEventListener('keydown', handleDown);
      document.removeEventListener('keyup', handleUp);
    };
  });

  return (
    <div className='midi-keyboard'>
      <div className='octave-changer-label'>Octave</div>
      <div className='octave-changer'>
        <button onClick={() => setOctaveOffset(Math.min(octaveOffset + 1, 4))}>↑</button>
        <button onClick={() => setOctaveOffset(Math.max(octaveOffset - 1, -1))}>↓</button>
      </div>
      <div
        style={{
          width:
            Math.min(document.documentElement.clientWidth ?? window.innerWidth ?? 0, 1000) - 64,
        }}
      >
        <Piano
          noteRange={{
            first: START_NOTE + octaveOffset * MIDI_NOTES_PER_OCTAVE,
            last: START_NOTE + 15 + octaveOffset * MIDI_NOTES_PER_OCTAVE,
          }}
          playNote={playNote}
          stopNote={releaseNote}
          activeNotes={alreadyDownNotes.toArray()}
          renderNoteLabel={({
            midiNumber,
          }: {
            keyboardShortcut: string | null | undefined;
            midiNumber: number;
            isActive: boolean;
            isAccidental: boolean;
          }) => {
            const octaveBase = START_NOTE + octaveOffset * MIDI_NOTES_PER_OCTAVE;
            const index = midiNumber - octaveBase;
            return (
              <div
                style={{ paddingLeft: 2, paddingRight: 2, color: '#353535', userSelect: 'none' }}
              >
                {keys[index].toUpperCase()}
              </div>
            );
          }}
        />
      </div>
    </div>
  );
};

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
      <MidiKeyboard
        octaveOffset={octaveOffset}
        onOctaveOffsetChange={(newOctaveOffset: number) =>
          dispatch(actionCreators.midiKeyboard.SET_OCTAVE_OFFSET(stateKey, newOctaveOffset))
        }
        onAttack={midiNumber => midiNode.outputCbs.forEach(cbs => cbs.onAttack(midiNumber, 255))}
        onRelease={midiNumber => midiNode.outputCbs.forEach(cbs => cbs.onRelease(midiNumber, 255))}
      />
    </div>
  );
};
