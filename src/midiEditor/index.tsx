import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { Map } from 'immutable';

import {
  AudioConnectables,
  create_empty_audio_connectables,
  ConnectableOutput,
} from 'src/patchNetwork';
import { getSynthsMap } from 'src/redux/modules/synths';
import MIDIEditorUI, { buildMIDIEditorUIDomId } from 'src/midiEditor/MIDIEditorUI';
import { getEngine } from 'src';
import { store } from 'src/redux';

export const hide_midi_editor = (vcId: string) => {
  document.getElementById(buildMIDIEditorUIDomId(vcId))!.style.display = 'none';
};

export const unhide_midi_editor = (vcId: string) => {
  document.getElementById(buildMIDIEditorUIDomId(vcId))!.style.display = 'block';
};

export const create_midi_editor_audio_connectables = (vcId: string): AudioConnectables => {
  const synth = getSynthsMap()[vcId];

  if (!synth) {
    console.error(`Tried to retrieve synth for vc id ${vcId} but it doesn't exist in the map`);
    return create_empty_audio_connectables(vcId);
  }

  return {
    vcId,
    inputs: Map(),
    outputs: Map<string, ConnectableOutput>().set('synth', {
      node: synth.volume,
      type: 'customAudio',
    }),
  };
};

export const init_midi_editor_ui = (vcId: string) => {
  const container = document.createElement('div');
  container.id = buildMIDIEditorUIDomId(vcId);
  document.getElementById('root')!.append(container);

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

  ReactDOM.unmountComponentAtNode(container);
  container.remove();
};
