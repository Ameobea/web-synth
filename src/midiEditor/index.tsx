import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { Map as ImmMap } from 'immutable';
import { Option } from 'funfix-core';
import { UnreachableException, UnimplementedError } from 'ameo-utils';

import {
  AudioConnectables,
  create_empty_audio_connectables,
  ConnectableOutput,
  ConnectableInput,
} from 'src/patchNetwork';
import MIDIEditorUI, { buildMIDIEditorUIDomId } from 'src/midiEditor/MIDIEditorUI';
import { getEngine } from 'src';
import { store } from 'src/redux';
import { MIDINode, buildMIDINode } from 'src/patchNetwork/midiNode';
import { VoiceManagerWrapper, mkVoiceManagerWrapper } from 'src/patchNetwork/voiceManagerWrapper';

export interface MIDIEditorState {
  midiRecordingCtxPtr: Option<number>;
  inputMIDINode: MIDINode;
  midiNode: MIDINode;
  voiceManager: VoiceManagerWrapper;
}

const ctx = new AudioContext();

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
    inputs: ImmMap<string, ConnectableInput>().set('midi_input', {
      node: state.inputMIDINode,
      type: 'midi',
    }),
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

  const midiEditorState: MIDIEditorState = {
    midiRecordingCtxPtr: Option.none(),
    inputMIDINode: null as any,
    midiNode,
    voiceManager: mkVoiceManagerWrapper(midiNode),
  };

  // And build one for accepting MIDI input when recording
  const inputMIDINode = buildMIDINode(() => ({
    onAttack: (noteId: number, voiceIx: number, velocity: number, offset?: number | undefined) => {
      midiEditorState.midiRecordingCtxPtr.forEach(ptr =>
        getEngine()!.midi_editor_record_note_down(ptr, ctx.currentTime, noteId)
      );

      midiNode.outputCbs.forEach(outputCbs =>
        outputCbs.onAttack(noteId, voiceIx, velocity, offset)
      );
    },
    onRelease: (noteId: number, voiceIx: number, velocity: number, offset?: number | undefined) => {
      midiEditorState.midiRecordingCtxPtr.forEach(ptr =>
        getEngine()!.midi_editor_record_note_up(ptr, ctx.currentTime, noteId)
      );

      midiNode.outputCbs.forEach(outputCbs =>
        outputCbs.onRelease(noteId, voiceIx, velocity, offset)
      );
    },
    onClearAll: (...args) => {
      midiEditorState.midiRecordingCtxPtr.forEach(_ptr => {
        throw new UnimplementedError();
      });

      midiNode.outputCbs.forEach(outputCbs => outputCbs.onClearAll(...args));
    },
    onPitchBend: (..._args) => {
      // throw new UnimplementedError();
    },
  }));
  midiEditorState.inputMIDINode = inputMIDINode;

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
