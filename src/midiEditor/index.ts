import { Map } from 'immutable';

import { AudioConnectables } from 'src/patchNetwork';

export const init_midi_editor = () =>
  document.getElementById('canvases')!.setAttribute('style', '');

export const cleanup_midi_editor = () =>
  document.getElementById('canvases')!.setAttribute('style', 'display: none;');

export const create_midi_editor_audio_connectables = (vcId: string): AudioConnectables => {
  const dummyNode = new AudioContext().createGain();

  // TODO: This needs to get actual audio nodes from the active MIDI editor instance
  return {
    vcId,
    inputs: Map<string, AudioNode | AudioParam>().set('gain', dummyNode.gain),
    outputs: Map<string, AudioNode>().set('output', dummyNode),
  };
};
