import * as R from 'ramda';
import { Option } from 'funfix-core';

import { MIDIEditorStateMap } from './';
import { cancelCb, scheduleEvent } from 'src/eventScheduler';

const ctx = new AudioContext();

const getState = (vcId: string) => {
  const state = MIDIEditorStateMap.get(vcId);
  if (!state) {
    console.error(
      `Tried to retrieve state for MIDI editor with vcId "${vcId}" but no entry exists`
    );
    return null;
  }

  return state;
};

const getMIDINode = (vcId: string) => Option.of(getState(vcId)).map(R.prop('midiNode')).orNull();

export const midi_editor_trigger_attack = (vcId: string, noteId: number) => {
  const midiNode = getMIDINode(vcId);
  if (!midiNode) {
    return;
  }

  midiNode.onAttack(noteId, 255);
};

export const midi_editor_trigger_release = (vcId: string, noteId: number) => {
  const midiNode = getMIDINode(vcId);
  if (!midiNode) {
    return;
  }

  midiNode.onRelease(noteId, 255);
};

export const midi_editor_trigger_attack_release = (
  vcId: string,
  noteId: number,
  duration: number
) => {
  midi_editor_trigger_attack(vcId, noteId);
  scheduleEvent(ctx.currentTime + duration, () => midi_editor_trigger_release(vcId, noteId));
};

/**
 * Keeps track of scheduled callbacks for the MIDI editor so that they can be cancelled later.
 */
const PendingCbIds: Set<number> = new Set();

export const midi_editor_schedule_events = (
  vcId: string,
  isAttackFlags: number[],
  noteIds: number[],
  eventTimings: number[]
) => {
  for (let i = 0; i < isAttackFlags.length; i++) {
    const eventTime = eventTimings[i];
    const fn = isAttackFlags[i] ? midi_editor_trigger_attack : midi_editor_trigger_release;
    let cbId: number;
    // eslint-disable-next-line prefer-const
    cbId = scheduleEvent(eventTime, () => {
      fn(vcId, noteIds[i]);
      PendingCbIds.delete(cbId);
    });
    PendingCbIds.add(cbId);
  }
};

export const midi_editor_cancel_all_events = (vcId: string) => {
  const state = getState(vcId);
  if (!state) {
    return;
  }

  for (const cbId of PendingCbIds.values()) {
    cancelCb(cbId);
  }
  const midiNode = getMIDINode(vcId);
  if (!midiNode) {
    return;
  }
  midiNode.clearAll();
};

let registeredAnimationFrameCount = 0;
const RegisteredAnimationFrames: Map<number, number> = new Map();

export const register_midi_editor_loop_interval = (
  closure: (curTime: number) => void,
  intervalMs: number
): number => setInterval(() => closure(ctx.currentTime), intervalMs);

export const cancel_midi_editor_loop_interval = (handle: number) => clearInterval(handle);

export const midi_editor_register_animation_frame = (
  closure: (curTime: number) => void
): number => {
  const handle = registeredAnimationFrameCount;
  const cb = () => {
    closure(ctx.currentTime);
    RegisteredAnimationFrames.set(handle, requestAnimationFrame(cb));
  };

  RegisteredAnimationFrames.set(handle, requestAnimationFrame(cb));
  registeredAnimationFrameCount += 1;
  return handle;
};

export const midi_editor_cancel_animation_frame = (handle: number) => {
  const innerHandle = RegisteredAnimationFrames.get(handle);
  if (R.isNil(innerHandle)) {
    console.error(
      `Tried to cancel MIDI editor animation frame with handle ${handle} but none exists`
    );
    return;
  }
  RegisteredAnimationFrames.delete(handle);
  cancelAnimationFrame(innerHandle);
};

export const get_cur_audio_ctx_time = (): number => ctx.currentTime;
