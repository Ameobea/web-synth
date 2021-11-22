import React, { useCallback, useEffect, useMemo, useReducer } from 'react';
import * as R from 'ramda';
import { Piano, Keyboard } from 'react-piano';
import 'react-piano/dist/styles.css';
import { Set as ImmSet } from 'immutable';
import { UnreachableException } from 'ameo-utils';
import './MidiKeyboard.scss';

const MIDI_NOTES_PER_OCTAVE = 12 as const;
const START_NOTE = 32;

// Suppress annoying prop types error in the console that doesn't matter
Keyboard.propTypes = undefined;

// prettier-ignore
const keys = ['a','z', 's', 'x', 'c', 'f', 'v', 'g', 'b', 'n', 'j', 'm', 'k', ',', 'l', '.', '/', "'"];

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
  style?: React.CSSProperties;
}> = ({ octaveOffset, onOctaveOffsetChange, onAttack, onRelease, style }) => {
  const reducer = useCallback(
    (
      state: ImmSet<number>,
      action: { type: 'ADD' | 'REMOVE'; midiNumber: number } | { type: 'CLEAR' }
    ) => {
      if (action.type === 'ADD') {
        // Discard duplicate events coming from holding the key down
        if (state.has(action.midiNumber)) {
          return state;
        }

        onAttack(action.midiNumber);
        return state.add(action.midiNumber);
      } else if (action.type === 'REMOVE') {
        if (!state.has(action.midiNumber)) {
          return state;
        }

        onRelease(action.midiNumber);
        return state.remove(action.midiNumber);
      } else if (action.type === 'CLEAR') {
        return ImmSet();
      } else {
        throw new UnreachableException();
      }
    },
    [onAttack, onRelease]
  );
  const [alreadyDownNotes, setAlreadyDownNotes] = useReducer(reducer, ImmSet());

  const playNote = useMemo(
    () => (midiNumber: number) => setAlreadyDownNotes({ type: 'ADD', midiNumber }),
    []
  );

  const releaseNote = useMemo(
    () => (midiNumber: number) => setAlreadyDownNotes({ type: 'REMOVE', midiNumber }),
    []
  );

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
      if (R.isNil(keyMap[evt.key.toLowerCase()])) {
        return;
      }

      // Work around incredibly annoying Firefox functionality where the slash key opens
      // a "quick find" thing and takes focus away from the page
      const isEditing = (['input', 'textarea'] as (string | undefined)[]).includes(
        document.activeElement?.tagName.toLowerCase()
      );
      if (!isEditing) {
        evt.preventDefault();
      }

      if (evt.repeat) {
        return;
      }

      playNote(midiNumber);
    };
    const handleUp = (evt: KeyboardEvent) => {
      const midiNumber = keyMap[evt.key.toLowerCase()] + octaveOffset * MIDI_NOTES_PER_OCTAVE;
      if (R.isNil(keyMap[evt.key.toLowerCase()])) {
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
  }, [octaveOffset, playNote, releaseNote]);

  const activeNotes = useMemo(() => alreadyDownNotes.toArray(), [alreadyDownNotes]);

  return (
    <div
      className='midi-keyboard'
      style={style}
      onContextMenuCapture={evt => {
        evt.preventDefault();
        evt.stopPropagation();
        return false;
      }}
    >
      <div className='octave-controls-wrapper'>
        <div className='octave-changer-label'>Octave</div>
        <div className='octave-offset-display'>{octaveOffset}</div>
      </div>
      <div className='octave-changer'>
        <button onClick={() => setOctaveOffset(Math.min(octaveOffset + 1, 4))}>↑</button>
        <button onClick={() => setOctaveOffset(Math.max(octaveOffset - 1, -1))}>↓</button>
      </div>
      <div
        style={{
          width:
            Math.min(document.documentElement.clientWidth ?? window.innerWidth ?? 0, 1000) - 64,
        }}
        onContextMenuCapture={evt => {
          evt.preventDefault();
          evt.stopPropagation();
          return false;
        }}
        ref={elem => elem?.addEventListener('selectionchange', console.log)}
      >
        <Piano
          noteRange={{
            first: START_NOTE + octaveOffset * MIDI_NOTES_PER_OCTAVE - 1,
            last: START_NOTE + 16 + octaveOffset * MIDI_NOTES_PER_OCTAVE + 1,
          }}
          activeNotes={activeNotes}
          playNote={playNote}
          stopNote={releaseNote}
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
                {keys[index]?.toUpperCase() || ''}
              </div>
            );
          }}
        />
      </div>
    </div>
  );
};
