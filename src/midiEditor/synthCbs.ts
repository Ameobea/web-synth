import { MIDIEditorStateMap } from './';

const getVoiceManager = (vcId: string) => {
  const state = MIDIEditorStateMap.get(vcId);
  if (!state) {
    console.error(
      `Tried to retrieve MIDI node for MIDI editor with vcId "${vcId}" but no entry exists`
    );
    return null;
  }

  return state.voiceManager;
};

export const midi_editor_trigger_attack = (vcId: string, noteId: number, offset?: number) => {
  const voiceManager = getVoiceManager(vcId);
  if (!voiceManager) {
    return;
  }

  voiceManager.onAttack(noteId, undefined, offset);
};

export const midi_editor_trigger_release = (vcId: string, noteId: number, offset?: number) => {
  const voiceManager = getVoiceManager(vcId);
  if (!voiceManager) {
    return;
  }

  voiceManager.onRelease(noteId, offset);
};

export const midi_editor_trigger_attack_release = (
  vcId: string,
  noteId: number,
  duration: number
) => {
  midi_editor_trigger_attack(vcId, noteId);
  midi_editor_trigger_release(vcId, noteId, duration);
};

export const midi_editor_schedule_events = (
  vcId: string,
  isAttackFlags: number[],
  noteIds: number[],
  timings: number[]
) => {
  for (let i = 0; i < isAttackFlags.length; i++) {
    if (isAttackFlags[i]) {
      midi_editor_trigger_attack(vcId, noteIds[i], timings[i]);
    } else {
      midi_editor_trigger_release(vcId, noteIds[i], timings[i]);
    }
  }
};
