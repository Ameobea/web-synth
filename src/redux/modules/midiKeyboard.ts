import { buildActionGroup, buildModule } from 'jantix';

export interface MidiKeyboardStateItem {
  octaveOffset: number;
}

export type MidiKeyboardState = { [stateKey: string]: MidiKeyboardStateItem };

const DEFAULT_MIDI_KEYBOARD_STATE_ITEM: MidiKeyboardStateItem = {
  octaveOffset: 0,
};

const getInstance = (state: MidiKeyboardState, stateKey: string): MidiKeyboardStateItem | null => {
  const instanceState = state[stateKey];
  if (!instanceState) {
    console.error(
      `Tried to retrieve MIDI keyboard state for stateKey ${stateKey} but it wasn't set`
    );
    return null;
  }
  return instanceState;
};

const actionGroups = {
  ADD_MIDI_KEYBOARD: buildActionGroup({
    actionCreator: (stateKey: string, initialState?: MidiKeyboardStateItem) => ({
      type: 'ADD_MIDI_KEYBOARD',
      stateKey,
      initialState,
    }),
    subReducer: (state: MidiKeyboardState, { stateKey, initialState }) => ({
      ...state,
      [stateKey]: initialState || DEFAULT_MIDI_KEYBOARD_STATE_ITEM,
    }),
  }),
  DELETE_MIDI_KEYBOARD: buildActionGroup({
    actionCreator: (stateKey: string) => ({ type: 'DELETE_MIDI_KEYBOARD', stateKey }),
    subReducer: (state: MidiKeyboardState, { stateKey }) => {
      const newState = { ...state };
      delete newState[stateKey];
      return newState;
    },
  }),
  SET_OCTAVE_OFFSET: buildActionGroup({
    actionCreator: (stateKey: string, octaveOffset: number) => ({
      type: 'SET_OCTAVE_OFFSET',
      stateKey,
      octaveOffset,
    }),
    subReducer: (state: MidiKeyboardState, { stateKey, octaveOffset }) => {
      const instanceState = getInstance(state, stateKey);
      if (!instanceState) {
        return state;
      }
      return { ...state, [stateKey]: { ...instanceState, octaveOffset } };
    },
  }),
};

export default buildModule<MidiKeyboardState, typeof actionGroups>({}, actionGroups);
