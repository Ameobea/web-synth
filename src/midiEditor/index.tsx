import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { Map as ImmMap } from 'immutable';

import {
  AudioConnectables,
  create_empty_audio_connectables,
  ConnectableOutput,
} from 'src/patchNetwork';
import MIDIEditorUI, { buildMIDIEditorUIDomId } from 'src/midiEditor/MIDIEditorUI';
import { getEngine } from 'src';
import { store } from 'src/redux';
import { MIDINode, buildMIDINode } from 'src/patchNetwork/midiNode';
import { UnreachableException } from 'ameo-utils';

export interface MIDIEditorState {
  midiNode: MIDINode;
  voiceManager: typeof import('src/polysynth');
}

export const MIDIEditorStateMap: Map<string, MIDIEditorState> = new Map();

export const hide_midi_editor = (vcId: string) => {
  document.getElementById(buildMIDIEditorUIDomId(vcId))!.style.display = 'none';
};

export const unhide_midi_editor = (vcId: string) => {
  document.getElementById(buildMIDIEditorUIDomId(vcId))!.style.display = 'block';
};

export const create_midi_editor_audio_connectables = (vcId: string): AudioConnectables => {
  const state = MIDIEditorStateMap.get(vcId);
  if (!state) {
    console.error(
      `Tried to retrieve MIDI editor state for vc id ${vcId} but it doesn't exist in the map`
    );
    return create_empty_audio_connectables(vcId);
  }

  return {
    vcId,
    inputs: ImmMap(),
    outputs: ImmMap<string, ConnectableOutput>().set('midi_output', {
      node: state.midiNode,
      type: 'midi',
    }),
  };
};

export const init_midi_editor_ui = (vcId: string) => {
  const container = document.createElement('div');
  container.id = buildMIDIEditorUIDomId(vcId);
  document.getElementById('root')!.append(container);

  // Build a MIDI node for outputting MIDI events from the MIDI editor
  const midiNode = buildMIDINode(() => {
    throw new UnreachableException("MIDI editor MIDI node doesn't accept input");
  });
  const midiEditorState: MIDIEditorState = { midiNode };
  if (!!MIDIEditorStateMap.get(vcId)) {
    console.warn(`Existing entry in MIDI editor state map for vcId "${vcId}"; overwriting...`);
  }
  MIDIEditorStateMap.set(vcId, midiEditorState);

  ReactDOM.render(
    <Provider store={store}>
      <MIDIEditorUI engine={getEngine()!} vcId={vcId} />
    </Provider>,
    container
  );
};

export const cleanup_midi_editor_ui = (vcId: string) => {
  const domId = buildMIDIEditorUIDomId(vcId);
  const container = document.getElementById(domId);
  if (!container) {
    console.error(
      `Tried to cleanup MIDI editor with vcId ${vcId} but no element with id ${domId} exists in the DOM`
    );
    return;
  }

  const existed = MIDIEditorStateMap.delete(vcId);
  if (!existed) {
    console.error(
      `Tried to delete entry in MIDI editor state map for vcId "${vcId}" during cleanup, but none existed`
    );
  }

  ReactDOM.unmountComponentAtNode(container);
  container.remove();
};
