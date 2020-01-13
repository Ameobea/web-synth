import { UnimplementedError } from 'ameo-utils';

import { MIDIEditorStateMap } from './';

const getMIDINode = (vcId: string) => {
  const state = MIDIEditorStateMap.get(vcId);
  if (!state) {
    console.error(
      `Tried to retrieve MIDI node for MIDI editor with vcId "${vcId}" but no entry exists`
    );
    return null;
  }

  return state.midiNode;
};

export const midi_editor_trigger_attack = (vcId: string, noteId: number, offset?: number) => {
  const node = getMIDINode(vcId);
  if (!node) {
    return;
  }

  node.outputCbs.forEach(output => output.onAttack(noteId));
  throw new UnimplementedError();
};

export const midi_editor_trigger_release = (vcId: string, noteId: number, offset?: number) => {
  const node = getMIDINode(vcId);
  if (!node) {
    return;
  }

  throw new UnimplementedError();
};

export const midi_editor_trigger_attack_release = (
  vcId: string,
  noteId: number,
  duration: number
) => {
  midi_editor_trigger_attack(vcId, noteId);
  midi_editor_trigger_release(vcId, noteId, duration);
  throw new UnimplementedError();
};

export const midi_editor_schedule_events = (
  vcId: string,
  isAttackFlags: number[],
  noteIds: number,
  timings: number[]
) => {
  console.log({ isAttackFlags, noteIds, timings });
  throw new UnimplementedError();
};
