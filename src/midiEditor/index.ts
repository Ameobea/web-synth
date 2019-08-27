export const init_midi_editor = () =>
  document.getElementById('canvases')!.setAttribute('style', '');

export const cleanup_midi_editor = () =>
  document.getElementById('canvases')!.setAttribute('style', 'display: none;');
