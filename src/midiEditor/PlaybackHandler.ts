import * as R from 'ramda';
import { get } from 'svelte/store';

import {
  cancelCb,
  getCurBeat,
  getIsGlobalBeatCounterStarted,
  MIDIEventType,
  registerGlobalStartCB,
  registerGlobalStopCB,
  scheduleEventBeats,
  setCurBeat,
  stopAll,
  unregisterStartCB,
  unregisterStopCB,
} from 'src/eventScheduler';
import type { MIDIEditorInstance, SerializedMIDIEditorState } from 'src/midiEditor';
import type { ManagedMIDIEditorUIInstance } from 'src/midiEditor/MIDIEditorUIManager';

interface SchedulableNoteEvent {
  isAttack: boolean;
  lineIx: number;
}

class RecordingContext {
  private playbackHandler: MIDIEditorPlaybackHandler;
  private downNoteIdsByMIDINumber: Map<number, number> = new Map();
  private activeInstance: ManagedMIDIEditorUIInstance;

  constructor(
    playbackHandler: MIDIEditorPlaybackHandler,
    activeInstance: ManagedMIDIEditorUIInstance
  ) {
    this.playbackHandler = playbackHandler;
    this.activeInstance = activeInstance;
  }

  private getCurBeat(): number {
    return this.playbackHandler.getCursorPosBeats();
  }

  public tick() {
    const curBeat = this.getCurBeat();
    const uiInstance = this.activeInstance.uiInst;
    if (!uiInstance) {
      return;
    }

    // Udpate the lengths of all down notes
    for (const [midiNumber, noteID] of this.downNoteIdsByMIDINumber.entries()) {
      const noteBox = uiInstance.allNotesByID.get(noteID);
      if (!noteBox) {
        console.error(
          `Did not find down note id=${noteID} midiNumber=${midiNumber} in playback handler tick`
        );
        continue;
      }

      const startBeat = noteBox.note.startPoint;
      const newLength = curBeat - startBeat;
      const lineIx = uiInstance.lines.length - midiNumber;

      // handle wrapping around when looping
      if (newLength < 0) {
        this.onRelease(midiNumber);
        return;
      }

      uiInstance.resizeNoteHorizontalEnd(lineIx, startBeat, noteID, startBeat + newLength);
    }
  }

  public onAttack(midiNumber: number) {
    if (this.downNoteIdsByMIDINumber.has(midiNumber)) {
      // console.warn('Ignoring duplicate note down event for note id=' + midiNumber);
      return;
    }

    const curBeat = this.getCurBeat();
    const uiInstance = this.activeInstance.uiInst;
    if (!uiInstance) {
      return;
    }
    const wasm = uiInstance.wasm;
    if (!wasm) {
      return;
    }

    const lineIx = uiInstance.lines.length - midiNumber;
    const canAdd = wasm.instance.check_can_add_note(wasm.noteLinesCtxPtr, lineIx, curBeat, 0.001);
    if (!canAdd) {
      return;
    }

    const noteID = uiInstance.addNote(lineIx, curBeat, 0.001);
    this.downNoteIdsByMIDINumber.set(midiNumber, noteID);
  }

  public onRelease(midiNumber: number) {
    const curBeat = this.getCurBeat();
    const uiInstance = this.activeInstance.uiInst;
    if (!uiInstance) {
      return;
    }

    const noteID = this.downNoteIdsByMIDINumber.get(midiNumber);
    if (R.isNil(noteID)) {
      // console.warn('Note is not down when released: ', midiNumber);
      return;
    }
    const noteBox = uiInstance.allNotesByID.get(noteID);
    if (R.isNil(noteBox)) {
      console.error(`Not was in down map but didn't exist in all notes mapping; id=${noteID}`);
      this.downNoteIdsByMIDINumber.delete(noteID);
      return;
    }
    const startBeat = noteBox.note.startPoint;
    const newLength = curBeat - startBeat;
    const lineIx = uiInstance.lines.length - midiNumber;
    uiInstance.resizeNoteHorizontalEnd(lineIx, startBeat, noteID, startBeat + newLength);
    this.downNoteIdsByMIDINumber.delete(midiNumber);
  }

  public destroy() {
    for (const midiNumber of this.downNoteIdsByMIDINumber.keys()) {
      this.onRelease(midiNumber);
    }
  }
}

export default class MIDIEditorPlaybackHandler {
  public inst: MIDIEditorInstance;
  /**
   * This uniquely identifies a single playback instance.  It is used for internal scheduling
   * to determine if a given playback session has ended or not.
   */
  private playbackGeneration: number | null = null;
  private cbs: {
    start: (startBeat: number) => void;
    stop: () => void;
  };
  private loopPoint: number | null = null;
  private scheduledEventHandles: Set<number> = new Set();
  private heldLineIndicesByInstanceID: Map<string, Set<number>> = new Map();
  public recordingCtx: RecordingContext | null = null;
  public metronomeEnabled: boolean;

  private addHeldLineIndex = (instID: string, lineIx: number) => {
    if (!this.heldLineIndicesByInstanceID.has(instID)) {
      this.heldLineIndicesByInstanceID.set(instID, new Set());
    }
    this.heldLineIndicesByInstanceID.get(instID)!.add(lineIx);
  };

  private removeHeldLineIndex = (instID: string, lineIx: number) => {
    if (!this.heldLineIndicesByInstanceID.has(instID)) {
      return;
    }
    this.heldLineIndicesByInstanceID.get(instID)!.delete(lineIx);
  };

  public get isPlaying() {
    return this.playbackGeneration !== null;
  }

  constructor(inst: MIDIEditorInstance, initialState: SerializedMIDIEditorState) {
    this.inst = inst;
    this.loopPoint = initialState.loopPoint;
    this.metronomeEnabled = initialState.metronomeEnabled;
    this.cbs = {
      start: (startBeat: number) => this.onGlobalStart(startBeat),
      stop: () => this.stopPlayback(),
    };
    registerGlobalStartCB(this.cbs.start);
    registerGlobalStopCB(this.cbs.stop);
  }

  public getLoopPoint(): number | null {
    return this.loopPoint;
  }

  /**
   * Retruns `true` if the loop point was actually updated and `false` if it wasn't updated due to
   * playback currently being active or something else.
   */
  public setLoopPoint(newLoopPoint: number | null): boolean {
    if (this.isPlaying) {
      console.warn("Can't set loop point while MIDI editor is playing");
      return false;
    }

    this.loopPoint = newLoopPoint;
    for (const inst of get(this.inst.uiManager.instances)) {
      if (inst.type === 'cvOutput') {
        inst.instance.setLoopPoint(newLoopPoint);
      }
    }

    return true;
  }

  public getCursorPosBeats(): number {
    const curGlobalBeat = getCurBeat();
    return this.loopPoint === null ? curGlobalBeat : curGlobalBeat % this.loopPoint;
  }

  /**
   * Returns `true` if the cursor pos was successfuly set and playback updated to match its new position and `false`
   * if the cursor position was not changed due to it being controlled externally or something else.
   */
  public setCursorPosBeats(cursorPosBeats: number): boolean {
    if (getIsGlobalBeatCounterStarted()) {
      return false;
    }

    cursorPosBeats = Math.max(cursorPosBeats, 0);

    if (this.isPlaying) {
      // TODO: Handle re-starting global event counter
      return false;
    }

    setCurBeat(cursorPosBeats);
    for (const inst of get(this.inst.uiManager.instances)) {
      if (inst.type === 'cvOutput') {
        inst.instance.handleCursorPosChange(cursorPosBeats);
      }
    }

    return true;
  }

  private onGlobalStart(startBeat: number) {
    if (this.isPlaying) {
      this.stopPlayback();
    }
    this.startPlayback(startBeat);
  }

  /**
   * Returns notes in the provided range of beats
   */
  private getNotesInRange(
    inst: ManagedMIDIEditorUIInstance,
    startBeatInclusive: number | null,
    endBeatExclusive: number | null,
    offset = 0
  ): Map<number, SchedulableNoteEvent[]> {
    const noteEventsByBeat: Map<number, SchedulableNoteEvent[]> = new Map();
    const cb = (isAttack: boolean, lineIx: number, rawBeat: number) => {
      const beat = rawBeat + offset;
      let entry = noteEventsByBeat.get(beat);
      if (!entry) {
        entry = [];
        noteEventsByBeat.set(beat, entry);
      }
      entry.push({ isAttack, lineIx });
    };
    inst.iterNotesWithCB(startBeatInclusive, endBeatExclusive, cb);

    return noteEventsByBeat;
  }

  private scheduleNotes(
    managedInst: ManagedMIDIEditorUIInstance,
    noteEventsByBeat: Map<number, SchedulableNoteEvent[]>
  ) {
    const lineCount = managedInst.lineCount;
    for (const [beat, entries] of noteEventsByBeat.entries()) {
      const handle: { current: number } = { current: 0 };
      const cb = () => {
        entries.forEach(({ isAttack, lineIx }) => {
          if (isAttack) {
            managedInst.uiInst?.onGated(lineIx);
            this.addHeldLineIndex(managedInst.id, lineIx);
          } else {
            managedInst.uiInst?.onUngated(lineIx);
            this.removeHeldLineIndex(managedInst.id, lineIx);
          }

          this.scheduledEventHandles.delete(handle.current);
        });
      };

      for (const { isAttack, lineIx } of entries) {
        const midiNumber = lineCount - lineIx;
        managedInst.midiOutput.scheduleEvent(beat, {
          type: isAttack ? MIDIEventType.Attack : MIDIEventType.Release,
          note: midiNumber,
          velocity: 255,
        });
      }

      handle.current = scheduleEventBeats(beat, cb);

      this.scheduledEventHandles.add(handle.current);
    }
  }

  private cancelAllScheduledNotes() {
    for (const eventHandle of this.scheduledEventHandles.values()) {
      cancelCb(eventHandle);
    }
    this.scheduledEventHandles.clear();

    for (const [instID, map] of this.heldLineIndicesByInstanceID.entries()) {
      const inst = this.inst.uiManager.getMIDIEditorInstanceByID(instID);
      if (!inst) {
        continue;
      }

      for (const lineIx of map.values()) {
        inst.midiInput.onRelease(inst.lineCount - lineIx, 255);
        inst.uiInst?.onUngated(lineIx);
      }
    }
    this.heldLineIndicesByInstanceID.clear();
  }

  /**
   * Schedules note events for one play through of all notes in the MIDI editor, starting at the specified `startBeat`.
   */
  private scheduleOneshot(startBeat: number) {
    const insts = get(this.inst.uiManager.instances);
    for (const inst of insts) {
      if (inst.type !== 'midiEditor') {
        continue;
      }
      const notesInRange = this.getNotesInRange(inst.instance, startBeat, null);
      this.scheduleNotes(inst.instance, notesInRange);
    }
  }

  private scheduleLoop(startBeat: number) {
    const loopPoint = this.loopPoint!;
    const loopLengthBeats = loopPoint;
    const playbackGeneration = this.playbackGeneration;

    const scheduleAnother = (loopIx: number) => {
      // If playback has been canceled, don't schedule anything more.
      if (this.playbackGeneration !== playbackGeneration) {
        return;
      }

      const firstLoopRemainder = loopLengthBeats - (startBeat % loopLengthBeats);
      const curSegmentAbsoluteStartBeat =
        startBeat - (loopLengthBeats - firstLoopRemainder) + loopIx * loopLengthBeats;
      const curSegmentAbsoluteEndBeat = curSegmentAbsoluteStartBeat + loopLengthBeats;

      const insts = get(this.inst.uiManager.instances);
      for (const inst of insts) {
        if (inst.type !== 'midiEditor') {
          continue;
        }
        const instance = inst.instance;

        // If we're starting in the middle of a loop on the first loop iteration, filter out notes that
        // start before the starting cursor position
        const notesInRange = this.getNotesInRange(
          instance,
          loopIx === 0 ? startBeat % loopLengthBeats : 0,
          loopPoint,
          curSegmentAbsoluteStartBeat
        );

        this.scheduleNotes(instance, notesInRange);
      }

      // Schedule an event before the loop ends to recursively schedule another.

      scheduleEventBeats(curSegmentAbsoluteEndBeat - Math.min(1, loopLengthBeats / 2), () =>
        scheduleAnother(loopIx + 1)
      );
    };

    // Kick off the sick recursive scheduler
    scheduleAnother(0);
  }

  private scheduleMetronome(startBeat: number) {
    const playMetronome = () => {
      // TODO
    };

    const scheduleAnother = (loopIx: number) => {
      // Schedule 20 beats and then recursively re-schedule
      const loopStartBeat = Math.ceil(startBeat) + loopIx * 20;
      for (let i = 0; i < 20; i++) {
        const eventID = scheduleEventBeats(loopStartBeat + i, () => {
          playMetronome();
          this.scheduledEventHandles.delete(eventID);
        });
        this.scheduledEventHandles.add(eventID);
      }

      const eventID = scheduleEventBeats(loopStartBeat + 19, () => scheduleAnother(loopIx + 1));
      this.scheduledEventHandles.add(eventID);
    };

    scheduleAnother(0);
  }

  public startPlayback(startBeat: number) {
    if (this.isPlaying) {
      return;
    }

    for (const inst of get(this.inst.uiManager.instances)) {
      if (inst.type === 'cvOutput') {
        inst.instance.startPlayback();
      }
    }

    this.playbackGeneration = Math.random();
    if (this.loopPoint === null) {
      this.scheduleOneshot(startBeat);
    } else {
      this.scheduleLoop(startBeat);
    }

    if (this.metronomeEnabled) {
      this.scheduleMetronome(startBeat);
    }
  }

  public stopPlayback() {
    stopAll();

    if (!this.isPlaying) {
      return;
    }

    for (const inst of get(this.inst.uiManager.instances)) {
      if (inst.type === 'cvOutput') {
        inst.instance.stopPlayback();
      }
    }

    this.playbackGeneration = null;
    this.cancelAllScheduledNotes();
    this.inst.uiManager.stopAllPlayback();
  }

  public startRecording(activeInstance: ManagedMIDIEditorUIInstance) {
    if (this.recordingCtx) {
      console.warn('Tried to start recording, but recording context already exists');
      return;
    }

    this.recordingCtx = new RecordingContext(this, activeInstance);
    if (!this.isPlaying) {
      // TODO: Fix
    }
  }

  public stopRecording() {
    if (!this.recordingCtx) {
      console.warn('Tried to start recording, but no recording ctx exists');
      return;
    }

    // Release all held notes instantly
    this.recordingCtx.destroy();

    // TODO: Fix

    this.recordingCtx = null;
  }

  public destroy() {
    this.stopPlayback();
    unregisterStartCB(this.cbs.start);
    unregisterStopCB(this.cbs.stop);
  }
}
