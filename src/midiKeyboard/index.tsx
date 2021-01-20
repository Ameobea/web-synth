/**
 * View context that creates a MIDI keyboard that is controllable via the normal keyboard and capable of being
 * connected to MIDI modules.
 */
import { Map as ImmMap } from 'immutable';

import { MIDINode } from 'src/patchNetwork/midiNode';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { MidiKeyboardVC } from 'src/midiKeyboard/MidiKeyboard';
import { store, dispatch, actionCreators, getState } from 'src/redux';
import { MidiKeyboardMode, MidiKeyboardStateItem } from 'src/redux/modules/midiKeyboard';
import { tryParseJson } from 'src/util';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { MIDIInput } from 'src/midiKeyboard/midiInput';
import { create_empty_audio_connectables } from 'src/redux/modules/vcmUtils';

const ctx = new AudioContext();

export const midiNodesByStateKey: Map<string, MIDINode> = new Map();

const getMidiKeyboardDomId = (vcId: string) => `midiKeyboard_${vcId}`;

export const init_midi_keyboard = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const midiNode = new MIDINode();
  midiNodesByStateKey.set(stateKey, midiNode);

  const elem = document.createElement('div');
  elem.id = getMidiKeyboardDomId(vcId);
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: 100vh; position: absolute; top: 0; left: 0;'
  );
  document.getElementById('content')!.appendChild(elem);

  const initialState = tryParseJson<Omit<MidiKeyboardStateItem, 'midiInput'>, undefined>(
    localStorage.getItem(stateKey)!,
    undefined,
    `Failed to parse localStorage state for MIDI keyboard with stateKey ${stateKey}; reverting to initial state.`
  );

  dispatch(
    actionCreators.midiKeyboard.ADD_MIDI_KEYBOARD(
      stateKey,
      initialState
        ? {
            ...initialState,
            midiInput:
              initialState.mode === MidiKeyboardMode.MidiInput
                ? new MIDIInput(ctx, midiNode, initialState.midiInputName)
                : undefined,
          }
        : undefined
    )
  );

  mkContainerRenderHelper({ Comp: MidiKeyboardVC, getProps: () => ({ stateKey }), store })(
    getMidiKeyboardDomId(vcId)
  );
};

const getMidiKeyboardDomElem = (stateKey: string): HTMLDivElement | null => {
  const vcId = stateKey.split('_')[1]!;

  const elem = document.getElementById(getMidiKeyboardDomId(vcId));
  if (!elem) {
    console.warn(`Tried to get MIDI keyboard DOM node with VC ID ${vcId} but it wasn't mounted`);
    return null;
  }

  return elem as HTMLDivElement;
};

export const cleanup_midi_keyboard = (stateKey: string): string => {
  const vcId = stateKey.split('_')[1]!;
  midiNodesByStateKey.delete(stateKey);

  const elem = getMidiKeyboardDomElem(stateKey);
  if (!elem) {
    return '';
  }

  mkContainerCleanupHelper()(getMidiKeyboardDomId(vcId));

  const instanceState = getState().midiKeyboard[stateKey];
  if (!instanceState) {
    console.error(`No MIDI keyboard state for MIDI keyboard with state key ${stateKey}`);
    return '';
  }
  const toSerialize = { ...instanceState };
  delete toSerialize.midiInput;
  return JSON.stringify(toSerialize);
};

export const hide_midi_keyboard = (stateKey: string) => {
  const elem = getMidiKeyboardDomElem(stateKey);

  if (elem) {
    elem.style.display = 'none';
  }
};

export const unhide_midi_keyboard = (stateKey: string) => {
  const elem = getMidiKeyboardDomElem(stateKey);

  if (elem) {
    elem.style.display = 'block';
  }
};

export const get_midi_keyboard_audio_connectables = (stateKey: string): AudioConnectables => {
  const vcId = stateKey.split('_')[1]!;
  const midiNode = midiNodesByStateKey.get(stateKey);
  if (!midiNode) {
    console.warn(`No MIDI node found for VC with VC ID "${vcId}"`);
    return create_empty_audio_connectables(vcId);
  }

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>(),
    outputs: ImmMap<string, ConnectableOutput>().set('midi out', { node: midiNode, type: 'midi' }),
  };
};
