import {
  cancelCb,
  getCurBeat,
  getIsGlobalBeatCounterStarted,
  registerStartCB,
  registerStopCB,
  scheduleEventBeats,
  scheduleEventTimeAbsolute,
  unregisterStartCB,
  unregisterStopCB,
} from 'src/eventScheduler';
import { getGlobalBpm } from 'src/globalMenu';
import { MIDIEditorInstance } from 'src/midiEditor';

interface SchedulableNoteEvent {
  isAttack: boolean;
  lineIx: number;
}

type ScheduleParams =
  | { type: 'globalBeatCounter'; curBeat: number }
  | { type: 'localTempo'; bpm: number; startTime: number };

const ctx = new AudioContext();

export default class MIDIEditorPlaybackHandler {
  private inst: MIDIEditorInstance;
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
  private heldLineIndices: Set<number> = new Set();

  public get isPlaying() {
    return this.playbackGeneration !== null;
  }

  constructor(inst: MIDIEditorInstance, initialCursorPosBeats: number) {
    this.inst = inst;
    this.lastSetCursorPosBeats = initialCursorPosBeats;
    this.cbs = {
      start: () => this.onGlobalStart(),
      stop: () => this.stopPlayback(),
    };
    registerStartCB(this.cbs.start);
    registerStopCB(this.cbs.stop);
  }

  public getLoopPoint(): number | null {
    return this.loopPoint;
  }

  public setLoopPoint(newLoopPoint: number | null) {
    if (this.isPlaying) {
      console.warn("Can't set loop point while MIDI editor is playing");
      return;
    }

    this.loopPoint = newLoopPoint;
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
    noteEventsByBeat: Map<number, SchedulableNoteEvent[]>,
    scheduleParams: ScheduleParams
  ) {
    const lineCount = this.inst.lineCount;
    for (const [beat, entries] of noteEventsByBeat.entries()) {
      let handle: number;
      const cb = () => {
        console.log('cb');
        entries.forEach(({ isAttack, lineIx }) => {
          if (isAttack) {
            this.inst.midiInput.onAttack(lineCount - lineIx, 255);
            this.inst.uiInstance?.onGated(lineIx);
            this.heldLineIndices.add(lineIx);
          } else {
            this.inst.midiInput.onRelease(lineCount - lineIx, 255);
            this.inst.uiInstance?.onUngated(lineIx);
            this.heldLineIndices.delete(lineIx);
          }

          this.scheduledEventHandles.delete(handle);
        });
      };

      if (scheduleParams.type === 'globalBeatCounter') {
        handle = scheduleEventBeats(scheduleParams.curBeat + beat, cb);
      } else {
        const beatsPerSecond = scheduleParams.bpm / 60;
        const secondsPerBeat = 1 / beatsPerSecond;
        const secondsFromStart = beat * secondsPerBeat;
        console.log({
          startTime: scheduleParams.startTime,
          secondsFromStart,
          now: ctx.currentTime,
        });
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

    for (const lineIx of this.heldLineIndices) {
      this.inst.midiInput.onRelease(this.inst.lineCount - lineIx, 255);
      this.inst.uiInstance?.onUngated(lineIx);
    }
    this.heldLineIndices.clear();
  }

  /**
   * Schedules note events for one play through of all notes in the MIDI editor, starting at the cursor position.
   */
  private scheduleOneshot(scheduleParams: ScheduleParams) {
    const notesInRange = this.getNotesInRange(this.lastSetCursorPosBeats, null);
    this.scheduleNotes(notesInRange, scheduleParams);
  }

  private scheduleLoop(scheduleParams: ScheduleParams) {
    const loopPoint = this.loopPoint!;
    const notesInRange = this.getNotesInRange(0, loopPoint);
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
          const nextLoopRelativeStartTime = loopLengthBeats * secondsPerBeat;
          return {
            type: 'localTempo' as const,
            bpm: scheduleParams.bpm,
            startTime: scheduleParams.startTime + nextLoopRelativeStartTime,
          };
        }
      })();

      this.scheduleNotes(notesInRange, newScheduleParams);

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
        const loopLengthSeconds = this.loopPoint! * scheduleParams.bpm;
        const thisLoopEndTime = scheduleParams.startTime + loopLengthSeconds * (loopIx + 1);
        scheduleEventTimeAbsolute(thisLoopEndTime - 1, () => scheduleAnother(loopIx + 1));
      }
    };

    // Kick off the sick recursive scheduler
    scheduleAnother(0);
  }

  public startPlayback(scheduleParams: ScheduleParams) {
    if (this.isPlaying) {
      return;
    }

    this.lastPlaybackSchedulParams = scheduleParams;
    this.playbackGeneration = Math.random();
    if (this.loopPoint === null) {
      this.scheduleOneshot(scheduleParams);
    } else {
      this.scheduleLoop(scheduleParams);
    }
  }

  public stopPlayback() {
    if (!this.isPlaying) {
      return;
    }

    this.lastSetCursorPosBeats = this.getCursorPosBeats();
    this.playbackGeneration = null;
    this.cancelAllScheduledNotes();
  }

  public destroy() {
    unregisterStartCB(this.cbs.start);
    unregisterStopCB(this.cbs.stop);
  }
}
