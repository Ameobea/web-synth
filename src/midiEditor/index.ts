import { Map } from 'immutable';

import { AudioConnectables, create_empty_audio_connectables } from 'src/patchNetwork';
import { getSynthsMap } from 'src/redux/modules/synths';
import { MIDI_EDITOR_CONTROLS_ID } from 'src/App';

export const init_midi_editor = () =>
  document.getElementById('canvases')!.setAttribute('style', '');

export const cleanup_midi_editor = () =>
  document.getElementById('canvases')!.setAttribute('style', 'display: none;');

export const hide_midi_editor = (_vcId: string) => {
  document.getElementById('canvases')!.style.display = 'none';
  document.getElementById(MIDI_EDITOR_CONTROLS_ID)!.style.display = 'none';
};

export const unhide_midi_editor = (_vcId: string) => {
  document.getElementById('canvases')!.style.display = 'block';
  document.getElementById(MIDI_EDITOR_CONTROLS_ID)!.style.display = 'block';
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
    outputs: Map<string, AudioNode>().set('synth', synth.volume),
  };
};
