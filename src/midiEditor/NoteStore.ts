export interface Note {
  id: number;
  startPoint: number;
  length: number;
  velocity: number;
}

interface NoteLoc {
  lineIx: number;
  note: Note;
}

export default class NoteStore {
  private lines: Note[][];
  private byId: Map<number, NoteLoc> = new Map();
  private nextId = 1;

  constructor(lineCount: number) {
    this.lines = Array.from({ length: lineCount }, () => []);
  }

  public get lineCount(): number {
    return this.lines.length;
  }

  public getLine(lineIx: number): readonly Note[] {
    return this.lines[lineIx];
  }

  public getNote(id: number): Note | undefined {
    return this.byId.get(id)?.note;
  }

  public getLineIx(id: number): number | undefined {
    return this.byId.get(id)?.lineIx;
  }

  public get noteCount(): number {
    return this.byId.size;
  }

  public noteContaining(lineIx: number, beat: number): Note | undefined {
    if (lineIx < 0 || lineIx >= this.lines.length) {
      return undefined;
    }
    const arr = this.lines[lineIx];
    const idx = this.lowerBound(lineIx, beat);
    for (const candidate of [arr[idx - 1], arr[idx]]) {
      if (
        candidate &&
        candidate.startPoint <= beat &&
        beat < candidate.startPoint + candidate.length
      ) {
        return candidate;
      }
    }
    return undefined;
  }

  private lowerBound(lineIx: number, startPoint: number): number {
    const arr = this.lines[lineIx];
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid].startPoint < startPoint) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  public checkCanAddNote(lineIx: number, startPoint: number, length: number): boolean {
    if (lineIx < 0 || lineIx >= this.lines.length) {
      return false;
    }
    const arr = this.lines[lineIx];
    const endPoint = startPoint + length;
    const idx = this.lowerBound(lineIx, startPoint);
    if (idx > 0) {
      const prev = arr[idx - 1];
      if (prev.startPoint + prev.length > startPoint) {
        return false;
      }
    }
    if (idx < arr.length) {
      if (arr[idx].startPoint < endPoint) {
        return false;
      }
    }
    return true;
  }

  /**
   * Like {@link checkCanAddNote}, but notes whose id is in `excludeIds` are treated as absent.
   * Used for multi-note vertical drags where the selected notes are about to vacate their lines.
   */
  public checkCanAddNoteExcluding(
    lineIx: number,
    startPoint: number,
    length: number,
    excludeIds: Set<number>
  ): boolean {
    if (lineIx < 0 || lineIx >= this.lines.length) {
      return false;
    }
    const arr = this.lines[lineIx];
    const endPoint = startPoint + length;
    const idx = this.lowerBound(lineIx, startPoint);
    for (let i = idx - 1; i >= 0; i--) {
      if (excludeIds.has(arr[i].id)) {
        continue;
      }
      if (arr[i].startPoint + arr[i].length > startPoint) {
        return false;
      }
      break;
    }
    for (let i = idx; i < arr.length; i++) {
      if (excludeIds.has(arr[i].id)) {
        continue;
      }
      if (arr[i].startPoint < endPoint) {
        return false;
      }
      break;
    }
    return true;
  }

  /**
   * Returns the empty interval surrounding `beat` on the given line into which a new note can be
   * placed without overlapping neighbors.
   */
  public freeRangeAt(lineIx: number, beat: number): { start: number; end: number } {
    const arr = this.lines[lineIx];
    const idx = this.lowerBound(lineIx, beat);
    const prev = arr[idx - 1];
    return {
      start: prev ? prev.startPoint + prev.length : 0,
      end: idx < arr.length ? arr[idx].startPoint : Infinity,
    };
  }

  public addNote(
    lineIx: number,
    startPoint: number,
    length: number,
    velocity: number,
    id?: number
  ): number {
    if (startPoint < 0) {
      startPoint = 0;
    }
    if (!(length > 0)) {
      console.error(`NoteStore.addNote: invalid length=${length}`);
      return -1;
    }
    const noteId = id ?? this.nextId++;
    if (id !== undefined && id >= this.nextId) {
      this.nextId = id + 1;
    }
    const note: Note = { id: noteId, startPoint, length, velocity };
    const idx = this.lowerBound(lineIx, startPoint);
    this.lines[lineIx].splice(idx, 0, note);
    this.byId.set(noteId, { lineIx, note });
    return noteId;
  }

  /**
   * Bulk-loads a line from serialized state, shortening any note that overlaps its successor so the
   * store's no-overlap invariant holds even when the source data is corrupted or legacy. Notes that
   * collapse to non-positive length are dropped.
   */
  public loadLine(
    lineIx: number,
    notes: readonly { startPoint: number; length: number; velocity?: number }[]
  ): void {
    const sorted = [...notes].sort((a, b) => a.startPoint - b.startPoint);
    for (let i = 0; i < sorted.length; i++) {
      const n = sorted[i];
      const next = sorted[i + 1];
      const length =
        next && n.startPoint + n.length > next.startPoint
          ? next.startPoint - n.startPoint
          : n.length;
      if (length > 0) {
        this.addNote(lineIx, n.startPoint, length, n.velocity ?? 90);
      }
    }
  }

  public deleteNote(id: number): void {
    const loc = this.byId.get(id);
    if (!loc) {
      return;
    }
    const arr = this.lines[loc.lineIx];
    const idx = this.lowerBound(loc.lineIx, loc.note.startPoint);
    if (arr[idx]?.id === id) {
      arr.splice(idx, 1);
    } else {
      const linIdx = arr.findIndex(n => n.id === id);
      if (linIdx >= 0) {
        arr.splice(linIdx, 1);
      }
    }
    this.byId.delete(id);
  }

  public setNoteVelocity(id: number, velocity: number): void {
    const loc = this.byId.get(id);
    if (!loc) {
      return;
    }
    loc.note.velocity = velocity;
  }

  public moveNoteHorizontal(id: number, desiredStart: number): number {
    const loc = this.byId.get(id);
    if (!loc) {
      return -1;
    }
    if (desiredStart < 0) {
      desiredStart = 0;
    }
    const arr = this.lines[loc.lineIx];
    const note = loc.note;
    if (desiredStart === note.startPoint) {
      return note.startPoint;
    }

    const curIdx = this.lowerBound(loc.lineIx, note.startPoint);
    const prev = arr[curIdx - 1];
    const next = arr[curIdx + 1];
    const leftBound = prev ? prev.startPoint + prev.length : 0;
    const rightBound = next ? next.startPoint - note.length : Infinity;
    const newStart = Math.max(leftBound, Math.min(rightBound, desiredStart));
    if (newStart === note.startPoint) {
      return note.startPoint;
    }

    arr.splice(curIdx, 1);
    note.startPoint = newStart;
    arr.splice(this.lowerBound(loc.lineIx, newStart), 0, note);
    return newStart;
  }

  public resizeNoteStart(id: number, newStart: number): number {
    const loc = this.byId.get(id);
    if (!loc) {
      return -1;
    }
    if (newStart < 0) {
      newStart = 0;
    }
    const arr = this.lines[loc.lineIx];
    const note = loc.note;
    const endPoint = note.startPoint + note.length;
    if (newStart >= endPoint) {
      console.error(`NoteStore.resizeNoteStart: newStart=${newStart} >= end=${endPoint}`);
      return note.startPoint;
    }

    let realNewStart: number;
    if (newStart >= note.startPoint) {
      realNewStart = newStart;
    } else {
      const curIdx = this.lowerBound(loc.lineIx, note.startPoint);
      const prev = arr[curIdx - 1];
      const leftBound = prev ? prev.startPoint + prev.length : 0;
      realNewStart = Math.max(leftBound, newStart);
    }
    if (realNewStart === note.startPoint) {
      return note.startPoint;
    }

    const curIdx = this.lowerBound(loc.lineIx, note.startPoint);
    arr.splice(curIdx, 1);
    note.startPoint = realNewStart;
    note.length = endPoint - realNewStart;
    arr.splice(this.lowerBound(loc.lineIx, realNewStart), 0, note);
    return realNewStart;
  }

  public resizeNoteEnd(id: number, newEnd: number): number {
    const loc = this.byId.get(id);
    if (!loc) {
      return -1;
    }
    const note = loc.note;
    if (newEnd <= note.startPoint) {
      console.error(`NoteStore.resizeNoteEnd: newEnd=${newEnd} <= start=${note.startPoint}`);
      return note.startPoint + note.length;
    }

    let realNewEnd: number;
    const curEnd = note.startPoint + note.length;
    if (newEnd <= curEnd) {
      realNewEnd = newEnd;
    } else {
      const arr = this.lines[loc.lineIx];
      const curIdx = this.lowerBound(loc.lineIx, note.startPoint);
      const next = arr[curIdx + 1];
      realNewEnd = next ? Math.min(next.startPoint, newEnd) : newEnd;
    }
    note.length = realNewEnd - note.startPoint;
    return realNewEnd;
  }

  public moveNoteToLine(id: number, newLineIx: number): void {
    const loc = this.byId.get(id);
    if (!loc || loc.lineIx === newLineIx) {
      return;
    }
    const arr = this.lines[loc.lineIx];
    const curIdx = this.lowerBound(loc.lineIx, loc.note.startPoint);
    if (arr[curIdx]?.id === id) {
      arr.splice(curIdx, 1);
    } else {
      const linIdx = arr.findIndex(n => n.id === id);
      if (linIdx >= 0) {
        arr.splice(linIdx, 1);
      }
    }
    const newArr = this.lines[newLineIx];
    newArr.splice(this.lowerBound(newLineIx, loc.note.startPoint), 0, loc.note);
    loc.lineIx = newLineIx;
  }

  public setLineCount(newCount: number): void {
    while (this.lines.length < newCount) {
      this.lines.push([]);
    }
    while (this.lines.length > newCount) {
      const dropped = this.lines.pop()!;
      for (const note of dropped) {
        this.byId.delete(note.id);
      }
    }
  }

  public clear(): void {
    this.lines.forEach(arr => arr.splice(0, arr.length));
    this.byId.clear();
  }

  public iterRangeIds(
    startLineIx: number,
    endLineIx: number,
    startBeat: number,
    endBeat: number
  ): Set<number> {
    const ids = new Set<number>();
    if (startBeat < 0) {
      startBeat = 0;
    }
    const lo = Math.max(0, Math.min(startLineIx, endLineIx));
    const hi = Math.min(this.lines.length - 1, Math.max(startLineIx, endLineIx));
    for (let lineIx = lo; lineIx <= hi; lineIx++) {
      for (const note of this.lines[lineIx]) {
        if (note.startPoint + note.length < startBeat || note.startPoint > endBeat) {
          continue;
        }
        ids.add(note.id);
      }
    }
    return ids;
  }

  public iterEvents(
    startBeatInclusive: number,
    endBeatExclusive: number | null,
    cb: (isAttack: boolean, lineIx: number, beat: number, velocity: number) => void
  ): void {
    interface Evt {
      beat: number;
      lineIx: number;
      isAttack: boolean;
      velocity: number;
    }
    const events: Evt[] = [];

    for (let lineIx = 0; lineIx < this.lines.length; lineIx++) {
      for (const note of this.lines[lineIx]) {
        const noteEnd = note.startPoint + note.length;
        if (noteEnd <= startBeatInclusive) {
          continue;
        }
        if (endBeatExclusive !== null && note.startPoint >= endBeatExclusive) {
          continue;
        }

        const attackBeat = Math.max(note.startPoint, startBeatInclusive);
        const releaseBeat =
          endBeatExclusive === null ? noteEnd : Math.min(noteEnd, endBeatExclusive);
        events.push({ beat: attackBeat, lineIx, isAttack: true, velocity: note.velocity });
        events.push({ beat: releaseBeat, lineIx, isAttack: false, velocity: note.velocity });
      }
    }

    events.sort((a, b) => {
      if (a.beat !== b.beat) {
        return a.beat - b.beat;
      }
      // releases before attacks so the release of a note ending at beat N can't kill the attack
      // of an adjacent same-pitch note starting at beat N
      if (a.isAttack !== b.isAttack) {
        return a.isAttack ? 1 : -1;
      }
      return a.lineIx - b.lineIx;
    });

    for (const e of events) {
      cb(e.isAttack, e.lineIx, e.beat, e.velocity);
    }
  }
}
