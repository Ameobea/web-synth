import { MIDINode } from 'src/patchNetwork/midiNode';

/**
 * A wrapper around `MIDINode` that exposes voice management functionality
 */

export interface VoiceManagerWrapper {
  onAttack: (noteId: number, velocity?: number, offset?: number) => void;
  onRelease: (noteId: number, offset?: number) => void;
  reset: () => void;
}

export const mkVoiceManagerWrapper = (midiNode: MIDINode): VoiceManagerWrapper => {
  const polysynthModule = import('src/polysynth');

  let ctx: number | null = null;
  polysynthModule.then(mod => {
    const playNote = (voiceIx: number, note: number, velocity: number, offset?: number) =>
      midiNode.outputCbs.forEach(output => output.onAttack(note, voiceIx, velocity, offset));
    const releaseNote = (voiceIx: number, note: number, offset?: number) =>
      midiNode.outputCbs.forEach(output => output.onRelease(note, voiceIx, 255, offset));

    ctx = mod.create_polysynth_context(playNote, releaseNote);
  });

  return {
    onAttack: (noteId: number, velocity?: number, offset?: number) =>
      polysynthModule.then(
        mod => ctx !== null && mod.handle_note_down(ctx, noteId, velocity, offset)
      ),
    onRelease: (noteId: number, offset?: number) =>
      polysynthModule.then(mod => ctx !== null && mod.handle_note_up(ctx, noteId, offset)),
    reset: () => polysynthModule.then(mod => ctx !== null && mod.release_all(ctx)),
  };
};
