import {
  cancelCb,
  getCurBeat,
  getIsGlobalBeatCounterStarted,
  registerStartCB,
  registerStopCB,
  scheduleEventBeats,
  unregisterStartCB,
  unregisterStopCB,
} from 'src/eventScheduler';
import { getGlobalBpm } from 'src/globalMenu';
import { MIDIEditorInstance } from 'src/midiEditor';

interface SchedulableNoteEvent {
  isAttack: boolean;
  lineIx: number;
}

export default class MIDIEditorPlaybackHandler {
  private inst: MIDIEditorInstance;
  private cursorPosBeats;
  /**
   * This uniquely identifies a single playback instance.  It is used for internal scheduling
   * to determine if a given playback session has ended or not.
   */
  private playbackGeneration: number | null = null;
  private lastPlaybackStartBeat = 0;
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
    this.cursorPosBeats = initialCursorPosBeats;
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
      return this.cursorPosBeats;
    }

    const curGlobalBeat = getCurBeat();
    if (this.loopPoint !== null) {
      return (curGlobalBeat - this.lastPlaybackStartBeat) % this.loopPoint;
    } else {
      return curGlobalBeat - this.lastPlaybackStartBeat;
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
      // TODO: Handle re-scheduling
    }
    this.cursorPosBeats = cursorPosBeats;
    return true;
  }

  private onGlobalStart() {
    if (this.isPlaying) {
      this.stopPlayback();
    }
    this.cursorPosBeats = 0;
    this.startPlayback(0);
  }

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

  private scheduleNotes(curBeat: number, noteEventsByBeat: Map<number, SchedulableNoteEvent[]>) {
    const lineCount = this.inst.lineCount;
    for (const [beat, entries] of noteEventsByBeat.entries()) {
      const handle = scheduleEventBeats(curBeat + beat, () => {
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
      });
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
  private scheduleOneshot(curBeat: number) {
    const notesInRange = this.getNotesInRange(this.cursorPosBeats, null);
    this.scheduleNotes(curBeat, notesInRange);
  }

  private scheduleLoop(curBeat: number) {
    const loopPoint = this.loopPoint!;
    const notesInRange = this.getNotesInRange(0, loopPoint);
    const loopLengthBeats = loopPoint;
    const playbackGeneration = this.playbackGeneration;

    const scheduleAnother = (loopIx: number) => {
      // If playback has been canceled, don't schedule anything more.
      if (this.playbackGeneration !== playbackGeneration) {
        return;
      }

      this.scheduleNotes(curBeat + loopLengthBeats * loopIx, notesInRange);

      // Schedule an event before the loop ends to recursively schedule another.
      //
      // Make a good guess as to re-schedule based off the BPM.  If BPM increases very dramatically
      // while looping, it's possible we may miss some loops.
      //
      // TODO: configure more scheduling lookahead to provide more leeway
      const curBPM = getGlobalBpm();
      const curBPS = curBPM / 60;
      const oneSecondInBeats = curBPS;
      scheduleEventBeats(loopIx * (loopLengthBeats + 1) - oneSecondInBeats, () =>
        scheduleAnother(loopIx + 1)
      );
    };

    // Kick off the sick recursive scheduler
    scheduleAnother(0);
  }

  public startPlayback(curBeat: number) {
    if (this.isPlaying) {
      return;
    }

    this.lastPlaybackStartBeat = curBeat;
    this.playbackGeneration = Math.random();
    if (this.loopPoint === null) {
      this.scheduleOneshot(curBeat);
    } else {
      this.scheduleLoop(curBeat);
    }
  }

  public stopPlayback() {
    if (!this.isPlaying) {
      return;
    }

    this.cursorPosBeats = this.getCursorPosBeats();
    this.playbackGeneration = null;
    this.cancelAllScheduledNotes();
  }

  public destroy() {
    unregisterStartCB(this.cbs.start);
    unregisterStopCB(this.cbs.stop);
  }
}
