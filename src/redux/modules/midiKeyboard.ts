import { UnreachableException } from 'ameo-utils';
import { buildActionGroup, buildModule } from 'jantix';
import { midiNodesByStateKey } from 'src/midiKeyboard';

import { MIDIInput } from 'src/midiKeyboard/midiInput';

const ctx = new AudioContext();

export enum MidiKeyboardMode {
  /**
   * Uses an external MIDI device connected via WebMIDI
   */
  MidiInput,
  /**
   * Uses the normal computer keyboard keys to send MIDI events
   */
  ComputerKeyboard,
}

export interface MidiKeyboardStateItem {
  mode: MidiKeyboardMode;
  midiInput: MIDIInput | undefined;
  midiInputName: string | undefined;
  octaveOffset: number;
}

export type MidiKeyboardState = { [stateKey: string]: MidiKeyboardStateItem };

const DEFAULT_MIDI_KEYBOARD_STATE_ITEM: MidiKeyboardStateItem = {
  mode: MidiKeyboardMode.ComputerKeyboard,
  midiInput: undefined,
  midiInputName: undefined,
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
  SET_MIDI_INPUT_NAME: buildActionGroup({
    actionCreator: (stateKey: string, midiInputName: string | undefined) => ({
      type: 'SET_MIDI_INPUT_NAME',
      stateKey,
      midiInputName,
    }),
    subReducer: (state: MidiKeyboardState, { stateKey, midiInputName }) => {
      if (!state[stateKey].midiInput) {
        throw new UnreachableException(
          `No \`midiInput\` for stateKey=${stateKey} but we're handling input change`
        );
      }
      if (midiInputName) {
        const midiNode = midiNodesByStateKey.get(stateKey);
        if (!midiNode) {
          throw new UnreachableException(
            'No MIDI node found for midi keyboard with `stateKey`: ' + stateKey
          );
        }
        state[stateKey].midiInput!.connectMidiNode(midiNode);
        state[stateKey].midiInput!.handleSelectedInputName(midiInputName);
      } else {
        state[stateKey].midiInput!.disconnectMidiNode();
      }

      return {
        ...state,
        [stateKey]: {
          ...state[stateKey],
          midiInputName: midiInputName ? midiInputName : undefined,
        },
      };
    },
  }),
  SET_MIDI_INPUT_MODE: buildActionGroup({
    actionCreator: (stateKey: string, mode: MidiKeyboardMode) => ({
      type: 'SET_MIDI_INPUT_MODE',
      stateKey,
      mode,
    }),
    subReducer: (state: MidiKeyboardState, { stateKey, mode }) => {
      const midiNode = midiNodesByStateKey.get(stateKey);
      if (!midiNode) {
        throw new UnreachableException(
          'No MIDI node found for midi keyboard with `stateKey`: ' + stateKey
        );
      }

      const midiInput =
        state[stateKey].midiInput ??
        (mode === MidiKeyboardMode.MidiInput
          ? new MIDIInput(ctx, midiNode, state[stateKey].midiInputName)
          : undefined);

      if (mode !== MidiKeyboardMode.MidiInput && state[stateKey].midiInput) {
        state[stateKey].midiInput!.disconnectMidiNode();
      } else if (mode === MidiKeyboardMode.MidiInput) {
        if (state[stateKey].midiInput) {
          state[stateKey].midiInput!.connectMidiNode(midiNode);
        } else {
          state[stateKey].midiInput = new MIDIInput(ctx, midiNode);
        }
      }

      return {
        ...state,
        [stateKey]: { ...state[stateKey], midiInput, mode },
      };
    },
  }),
};

export default buildModule<MidiKeyboardState, typeof actionGroups>({}, actionGroups);
