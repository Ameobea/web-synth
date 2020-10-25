/**
 * View context that creates a MIDI keyboard that is controllable via the normal keyboard and capable of being
 * connected to MIDI modules.
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { Map } from 'immutable';
import { Provider } from 'react-redux';

import { buildMIDINode, MIDINode } from 'src/patchNetwork/midiNode';
import {
  create_empty_audio_connectables,
  AudioConnectables,
  ConnectableInput,
  ConnectableOutput,
} from 'src/patchNetwork';
import { MidiKeyboardVC } from 'src/midiKeyboard/MidiKeyboard';
import { store, dispatch, actionCreators, getState } from 'src/redux';
import { MidiKeyboardStateItem } from 'src/redux/modules/midiKeyboard';
import { tryParseJson } from 'src/util';

export let midiNodesByStateKey: Map<string, MIDINode> = Map();

const getMidiKeyboardDomId = (vcId: string) => `midiKeyboard_${vcId}`;

export const init_midi_keyboard = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  midiNodesByStateKey = midiNodesByStateKey.set(
    stateKey,
    buildMIDINode(() => {
      throw new Error('MIDI Keyboard does not accept MIDI input; it only creates output');
    })
  );

  const elem = document.createElement('div');
  elem.id = getMidiKeyboardDomId(vcId);
  elem.setAttribute('style', 'z-index: 2; height: 100vh; position: absolute; top: 0; left: 0;');
  document.getElementById('content')!.appendChild(elem);

  const initialState = tryParseJson<MidiKeyboardStateItem, undefined>(
    localStorage.getItem(stateKey)!,
    undefined,
    `Failed to parse localStorage state for MIDI keyboard with stateKey ${stateKey}; reverting to initial state.`
  );
  dispatch(actionCreators.midiKeyboard.ADD_MIDI_KEYBOARD(stateKey, initialState));

  ReactDOM.render(
    <Provider store={store}>
      <MidiKeyboardVC stateKey={stateKey} />
    </Provider>,
    elem
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
  midiNodesByStateKey = midiNodesByStateKey.delete(stateKey);

  const elem = getMidiKeyboardDomElem(stateKey);
  if (!elem) {
    return '';
  }

  ReactDOM.unmountComponentAtNode(elem);
  elem.remove();

  const instanceState = getState().midiKeyboard[stateKey];
  if (!instanceState) {
    console.error(`No MIDI keyboard state for MIDI keyboard with state key ${stateKey}`);
    return '';
  }
  return JSON.stringify(instanceState);
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
    inputs: Map<string, ConnectableInput>(),
    outputs: Map<string, ConnectableOutput>().set('midi out', { node: midiNode, type: 'midi' }),
  };
};
