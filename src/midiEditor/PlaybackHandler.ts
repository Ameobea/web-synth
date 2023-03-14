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
  scheduleEventTimeAbsolute,
  unregisterStartCB,
  unregisterStopCB,
} from 'src/eventScheduler';
import { getGlobalBpm } from 'src/globalMenu';
import type { MIDIEditorInstance, SerializedMIDIEditorState } from 'src/midiEditor';
import { ManagedMIDIEditorUIInstance } from 'src/midiEditor/MIDIEditorUIManager';

interface SchedulableNoteEvent {
  isAttack: boolean;
  lineIx: number;
}

type ScheduleParams =
  | { type: 'globalBeatCounter'; curBeat: number }
  | {
      type: 'localTempo';
      bpm: number;
      /**
       * The time from the global audio context at the instant playback was started
       */
      startTime: number;
    };

const ctx = new AudioContext();

class RecordingContext {
  private playbackHandler: MIDIEditorPlaybackHandler;
  private downNoteIdsByMIDINumber: Map<number, number> = new Map();

  constructor(playbackHandler: MIDIEditorPlaybackHandler) {
    this.playbackHandler = playbackHandler;
  }

  private getCurBeat(): number {
    return this.playbackHandler.getCursorPosBeats();
  }

  public tick() {
    const curBeat = this.getCurBeat();
    const uiInstance = this.playbackHandler.inst.uiInstance;
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
    const uiInstance = this.playbackHandler.inst.uiInstance;
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
    const uiInstance = this.playbackHandler.inst.uiInstance;
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
   * Ths last *set* cursor position.  The actual cursor position will be different if playback is active;
   * use `getCursorPosBeats()` to get the live cursor position during playback.
   */
  private lastSetCursorPosBeats;
  /**
   * This uniquely identifies a single playback instance.  It is used for internal scheduling
   * to determine if a given playback session has ended or not.
   */
  private playbackGeneration: number | null = null;
  private lastPlaybackSchedulParams: ScheduleParams = { type: 'globalBeatCounter', curBeat: 0 };
  private cbs: {
    start: () => void;
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
    this.lastSetCursorPosBeats = initialState.cursorPosBeats;
    this.loopPoint = initialState.loopPoint;
    this.metronomeEnabled = initialState.metronomeEnabled;
    this.cbs = {
      start: () => this.onGlobalStart(),
      stop: () => this.stopPlayback(),
    };
    registerGlobalStartCB(this.cbs.start);
    registerGlobalStopCB(this.cbs.stop);
  }

  public getLoopPoint(): number | null {
    return this.loopPoint;
  }

  /**
   * Retruns `true` if the loop point was actually updated and `false` if it wasn't udpated due to
   * playback currently being active or something else.
   */
  public setLoopPoint(newLoopPoint: number | null): boolean {
    if (this.isPlaying) {
      console.warn("Can't set loop point while MIDI editor is playing");
      return false;
    }

    this.loopPoint = newLoopPoint;
    get(this.inst.cvOutputs).forEach(cvOutput => cvOutput.setLoopPoint(this.loopPoint));
    return true;
  }

  public getCursorPosBeats(): number {
    if (!this.isPlaying) {
      return this.lastSetCursorPosBeats;
    }

    if (this.lastPlaybackSchedulParams.type === 'globalBeatCounter') {
      const curGlobalBeat = getCurBeat();
      if (this.loopPoint !== null) {
        return (curGlobalBeat - this.lastPlaybackSchedulParams.curBeat) % this.loopPoint;
      } else {
        return curGlobalBeat - this.lastPlaybackSchedulParams.curBeat;
      }
    } else {
      const timeSinceStarted = ctx.currentTime - this.lastPlaybackSchedulParams.startTime;
      const beatsPerSecond = this.lastPlaybackSchedulParams.bpm / 60;
      const beatsElapsed = this.lastSetCursorPosBeats + timeSinceStarted * beatsPerSecond;

      if (this.loopPoint !== null) {
        const loopLengthBeats = this.loopPoint;
        return beatsElapsed % loopLengthBeats;
      } else {
        return beatsElapsed;
      }
    }
  }

  /**
   * Returns `true` if the cursor pos was successfuly set and playback updated to match its new position and `false`
   * if the cursor position was not changed due to it being controlled externally or something else.
   */
  public setCursorPosBeats(cursorPosBeats: number) {
    if (getIsGlobalBeatCounterStarted()) {
      return false;
    }

    if (this.isPlaying) {
      if (this.lastPlaybackSchedulParams.type === 'globalBeatCounter') {
        // TODO: Handle re-starting global event counter
        return;
      }

      this.stopPlayback();
      this.lastSetCursorPosBeats = cursorPosBeats;
      this.startPlayback({ ...this.lastPlaybackSchedulParams, startTime: ctx.currentTime });
      return;
    } else {
      get(this.inst.cvOutputs).forEach(output => output.handleCursorPosChange(cursorPosBeats));
    }
    this.lastSetCursorPosBeats = cursorPosBeats;
    return true;
  }

  private onGlobalStart() {
    if (this.isPlaying) {
      this.stopPlayback();
    }
    this.lastSetCursorPosBeats = 0;
    this.startPlayback({ type: 'globalBeatCounter', curBeat: 0 });
  }

  /**
   * Returns notes in the provided range of beats, normalizing them to be relative to
   * `startBeatInclusive` ir provided.
   */
  private getNotesInRange(
    inst: ManagedMIDIEditorUIInstance,
    startBeatInclusive: number | null,
    endBeatExclusive: number | null
  ): Map<number, SchedulableNoteEvent[]> {
    const noteEventsByBeat: Map<number, SchedulableNoteEvent[]> = new Map();
    const cb = (isAttack: boolean, lineIx: number, rawBeat: number) => {
      const beat = rawBeat - (startBeatInclusive ?? 0);
      let entry = noteEventsByBeat.get(beat);
      if (!entry) {
        entry = [];
        noteEventsByBeat.set(beat, entry);
      }
      entry.push({ isAttack, lineIx });
    };

    const { instance, noteLinesCtxPtr } = this.inst.getWasmInstance();
    instance.iter_notes_with_cb(
      noteLinesCtxPtr,
      startBeatInclusive ?? 0,
      endBeatExclusive ?? -1,
      cb
    );
    return noteEventsByBeat;
  }

  private scheduleNotes(
    managedInst: ManagedMIDIEditorUIInstance,
    noteEventsByBeat: Map<number, SchedulableNoteEvent[]>,
    scheduleParams: ScheduleParams
  ) {
    const lineCount = managedInst.lineCount;
    for (const [beat, entries] of noteEventsByBeat.entries()) {
      let handle: number;
      const cb = () => {
        entries.forEach(({ isAttack, lineIx }) => {
          if (isAttack) {
            if (scheduleParams.type === 'localTempo') {
              managedInst.midiInput.onAttack(lineCount - lineIx, 255, true);
            }
            this.inst.uiInstance?.onGated(lineIx);
            this.addHeldLineIndex(managedInst.id, lineIx);
          } else {
            if (scheduleParams.type === 'localTempo') {
              managedInst.midiInput.onRelease(lineCount - lineIx, 255, true);
            }
            this.inst.uiInstance?.onUngated(lineIx);
            this.removeHeldLineIndex(managedInst.id, lineIx);
          }

          this.scheduledEventHandles.delete(handle);
        });
      };

      if (scheduleParams.type === 'globalBeatCounter') {
        for (const { isAttack, lineIx } of entries) {
          const midiNumber = lineCount - lineIx;
          managedInst.midiOutput.scheduleEvent(scheduleParams.curBeat + beat, {
            type: isAttack ? MIDIEventType.Attack : MIDIEventType.Release,
            note: midiNumber,
            velocity: 255,
          });
        }

        handle = scheduleEventBeats(scheduleParams.curBeat + beat, cb);
      } else {
        const beatsPerSecond = scheduleParams.bpm / 60;
        const secondsPerBeat = 1 / beatsPerSecond;
        const secondsFromStart = beat * secondsPerBeat;
        handle = scheduleEventTimeAbsolute(scheduleParams.startTime + secondsFromStart, cb);
      }

      this.scheduledEventHandles.add(handle);
    }
  }

  private cancelAllScheduledNotes() {
    for (const eventHandle of this.scheduledEventHandles.values()) {
      cancelCb(eventHandle);
    }
    this.scheduledEventHandles.clear();

    for (const [instID, map] of this.heldLineIndicesByInstanceID.entries()) {
      const inst = this.inst.uiManager.getInstanceByID(instID);
      if (!inst) {
        continue;
      }

      for (const lineIx of map.values()) {
        inst.midiInput.onRelease(inst.lineCount - lineIx, 255);
        inst.instance?.onUngated(lineIx);
      }
    }
    this.heldLineIndicesByInstanceID.clear();
  }

  /**
   * Schedules note events for one play through of all notes in the MIDI editor, starting at the cursor position.
   */
  private scheduleOneshot(scheduleParams: ScheduleParams) {
    const insts = get(this.inst.uiManager.instances);
    for (const inst of insts) {
      const notesInRange = this.getNotesInRange(inst, this.lastSetCursorPosBeats, null);
      this.scheduleNotes(inst, notesInRange, scheduleParams);
    }
  }

  private scheduleLoop(scheduleParams: ScheduleParams) {
    const loopPoint = this.loopPoint!;
    const loopLengthBeats = loopPoint;
    const playbackGeneration = this.playbackGeneration;

    const scheduleAnother = (loopIx: number) => {
      // If playback has been canceled, don't schedule anything more.
      if (this.playbackGeneration !== playbackGeneration) {
        return;
      }

      const newScheduleParams: ScheduleParams = (() => {
        if (scheduleParams.type === 'globalBeatCounter') {
          return {
            type: 'globalBeatCounter' as const,
            curBeat: scheduleParams.curBeat + loopLengthBeats * loopIx,
          };
        } else {
          const beatsPerSecond = scheduleParams.bpm / 60;
          const secondsPerBeat = 1 / beatsPerSecond;
          const loopLengthSeconds = loopLengthBeats * secondsPerBeat;
          let startTime = scheduleParams.startTime + loopLengthSeconds * loopIx;

          // Adjust start time to take into account starting the first loop part of the way through
          if (loopIx > 0) {
            startTime -= this.lastSetCursorPosBeats * secondsPerBeat;
          }

          return {
            type: 'localTempo' as const,
            bpm: scheduleParams.bpm,
            startTime,
          };
        }
      })();

      // If we're starting in the middle of a loop on the first loop iteration, filter out notes that
      // start before the starting cursor position
      const insts = get(this.inst.uiManager.instances);
      for (const inst of insts) {
        const notesInRange = this.getNotesInRange(inst, 0, loopPoint);
        if (this.lastPlaybackSchedulParams.type === 'localTempo' && loopIx === 0) {
          const clonedNotesInRange = new Map();
          for (const [beat, events] of notesInRange.entries()) {
            if (beat < this.lastSetCursorPosBeats) {
              continue;
            }
            clonedNotesInRange.set(beat - this.lastSetCursorPosBeats, events);
          }
          this.scheduleNotes(inst, clonedNotesInRange, newScheduleParams);
        } else {
          this.scheduleNotes(inst, notesInRange, newScheduleParams);
        }
      }

      // Schedule an event before the loop ends to recursively schedule another.
      //
      // Make a good guess as to re-schedule based off the BPM.  If BPM increases very dramatically
      // while looping, it's possible we may miss some loops.
      //
      // TODO: configure more scheduling lookahead to provide more leeway

      if (scheduleParams.type === 'globalBeatCounter') {
        const curBPM = getGlobalBpm();
        const curBPS = curBPM / 60;
        const oneSecondInBeats = curBPS;
        scheduleEventBeats(
          scheduleParams.curBeat + loopIx * (loopLengthBeats + 1) - oneSecondInBeats,
          () => scheduleAnother(loopIx + 1)
        );
      } else {
        const beatsPerSecond = scheduleParams.bpm / 60;
        const secondsPerBeat = 1 / beatsPerSecond;
        const loopLengthSeconds = loopLengthBeats * secondsPerBeat;
        const thisLoopEndTime =
          scheduleParams.startTime +
          loopLengthSeconds * (loopIx + 1) -
          this.lastSetCursorPosBeats * secondsPerBeat;
        scheduleEventTimeAbsolute(thisLoopEndTime - 1, () => scheduleAnother(loopIx + 1));
      }
    };

    // Kick off the sick recursive scheduler
    scheduleAnother(0);
  }

  private scheduleMetronome(scheduleParams: ScheduleParams) {
    const playMetronome = () => {
      // const node = new AudioBufferSourceNode(ctx, { buffer: MetronomeSampleBuffer });
      // node.start();
      // const dest = (ctx as any).globalVolume as GainNode;
      // node.connect(dest);
    };

    const scheduleAnother = (loopIx: number) => {
      if (scheduleParams.type === 'globalBeatCounter') {
        // Schedule 20 beats and then recursively re-schedule
        const startBeat = Math.ceil(scheduleParams.curBeat) + loopIx * 20;
        for (let i = 0; i < 20; i++) {
          const eventID = scheduleEventBeats(startBeat + i, () => {
            playMetronome();
            this.scheduledEventHandles.delete(eventID);
          });
          this.scheduledEventHandles.add(eventID);
        }

        const eventID = scheduleEventBeats(startBeat + 19, () => scheduleAnother(loopIx + 1));
        this.scheduledEventHandles.add(eventID);
      } else if (scheduleParams.type === 'localTempo') {
        const beatsPerSecond = scheduleParams.bpm / 60;
        const secondsPerBeat = 1 / beatsPerSecond;
        // If the cursor isn't exactly on a beat divider when playback is started, we need to account for that
        const cursorOffsetSeconds =
          secondsPerBeat * (this.lastSetCursorPosBeats - Math.trunc(this.lastSetCursorPosBeats));

        for (let i = 0; i < 20; i++) {
          const timeSeconds =
            scheduleParams.startTime +
            secondsPerBeat * 20 * loopIx +
            i * secondsPerBeat +
            cursorOffsetSeconds;
          const eventID = scheduleEventTimeAbsolute(timeSeconds, () => {
            playMetronome();
            this.scheduledEventHandles.delete(eventID);
          });
          this.scheduledEventHandles.add(eventID);
        }

        const eventID = scheduleEventTimeAbsolute(
          scheduleParams.startTime +
            secondsPerBeat * 20 * loopIx +
            19 * secondsPerBeat +
            cursorOffsetSeconds,
          () => scheduleAnother(loopIx + 1)
        );
        this.scheduledEventHandles.add(eventID);
      }
    };

    scheduleAnother(0);
  }

  public startPlayback(scheduleParams: ScheduleParams) {
    if (this.isPlaying) {
      return;
    }

    get(this.inst.cvOutputs).forEach(cvOutput => cvOutput.startPlayback());

    this.lastPlaybackSchedulParams = scheduleParams;
    this.playbackGeneration = Math.random();
    if (this.loopPoint === null) {
      this.scheduleOneshot(scheduleParams);
    } else {
      this.scheduleLoop(scheduleParams);
    }

    if (this.metronomeEnabled) {
      this.scheduleMetronome(scheduleParams);
    }
  }

  public stopPlayback() {
    if (!this.isPlaying) {
      return;
    }

    get(this.inst.cvOutputs).forEach(cvOutput => cvOutput.stopPlayback());

    this.lastSetCursorPosBeats = this.getCursorPosBeats();
    this.playbackGeneration = null;
    this.cancelAllScheduledNotes();
    this.inst.uiManager.stopAllPlayback();
  }

  public startRecording() {
    if (this.recordingCtx) {
      console.warn('Tried to start recording, but recording context already exists');
      return;
    }

    this.recordingCtx = new RecordingContext(this);
    if (!this.isPlaying) {
      this.startPlayback({
        type: 'localTempo',
        bpm: this.inst.localBPM,
        startTime: ctx.currentTime,
      });
    }
  }

  public stopRecording() {
    if (!this.recordingCtx) {
      console.warn('Tried to start recording, but no recording ctx exists');
      return;
    }

    // Release all held notes instantly
    this.recordingCtx.destroy();

    if (this.lastPlaybackSchedulParams.type === 'localTempo') {
      this.stopPlayback();
    }

    this.recordingCtx = null;
  }

  public destroy() {
    unregisterStartCB(this.cbs.start);
    unregisterStopCB(this.cbs.stop);
  }
}
