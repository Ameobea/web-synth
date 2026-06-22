// Order-independent transport clock + scheduled MIDI timeline.
//
// See `docs/midi-scheduling-redesign.md`.  This module is intentionally free of any Web Audio
// or DOM dependency so it can run unchanged inside an `AudioWorkletGlobalScope` and be unit
// tested off-thread.  All environment values (`currentFrame`, sample rate, frame size) are
// passed in by the caller.

export interface TempoSegment {
  startBeat: number;
  startFrame: number;
  bpm: number;
}

/**
 * Composition-level tempo definition: tempo becomes `bpm` at absolute `beat`.  This is the
 * canonical, frame-agnostic form authored on the UI side; the clock owner anchors it to actual
 * sample frames at playback start via `TempoMap.fromTempoChanges`.
 */
export interface TempoChange {
  beat: number;
  bpm: number;
}

/**
 * Piecewise-affine map between absolute sample frames and beats.  Immutable; tempo changes
 * produce a new instance which the owner pointer-swaps at a quantum boundary.
 */
export class TempoMap {
  readonly sampleRate: number;
  readonly segments: readonly TempoSegment[];

  constructor(sampleRate: number, segments: readonly TempoSegment[]) {
    if (segments.length === 0) {
      throw new Error('TempoMap requires at least one segment');
    }
    this.sampleRate = sampleRate;
    this.segments = segments;
  }

  static constant(sampleRate: number, bpm: number, startFrame = 0, startBeat = 0): TempoMap {
    return new TempoMap(sampleRate, [{ startBeat, startFrame, bpm }]);
  }

  /**
   * Builds a frame-anchored map from composition-level `(beat, bpm)` changes such that
   * `beatAt(anchorFrame) === anchorBeat`.  Called by the clock owner at playback start
   * (anchor = the latched start frame + start beat) and on live edits (anchor = current
   * frame + current beat), so editing tempo mid-playback keeps "now" continuous.
   */
  static fromTempoChanges(
    sampleRate: number,
    changes: readonly TempoChange[],
    anchorBeat: number,
    anchorFrame: number
  ): TempoMap {
    if (changes.length === 0) {
      throw new Error('fromTempoChanges requires at least one tempo change');
    }
    const sorted = [...changes].sort((a, b) => a.beat - b.beat);

    // Provisional frames with the first change at frame 0, then shift so the anchor lands on `anchorFrame`.
    const provFrames = new Array<number>(sorted.length);
    provFrames[0] = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      provFrames[i] = provFrames[i - 1] + ((sorted[i].beat - prev.beat) * 60 * sampleRate) / prev.bpm;
    }

    let k = 0;
    for (let i = sorted.length - 1; i > 0; i--) {
      if (anchorBeat >= sorted[i].beat) {
        k = i;
        break;
      }
    }
    const provAnchorFrame = provFrames[k] + ((anchorBeat - sorted[k].beat) * 60 * sampleRate) / sorted[k].bpm;
    const delta = anchorFrame - provAnchorFrame;

    const segments = sorted.map((c, i) => ({
      startBeat: c.beat,
      startFrame: provFrames[i] + delta,
      bpm: c.bpm,
    }));
    return new TempoMap(sampleRate, segments);
  }

  private segAtFrame(frame: number): TempoSegment {
    const segs = this.segments;
    for (let i = segs.length - 1; i > 0; i--) {
      if (frame >= segs[i].startFrame) {
        return segs[i];
      }
    }
    return segs[0];
  }

  private segAtBeat(beat: number): TempoSegment {
    const segs = this.segments;
    for (let i = segs.length - 1; i > 0; i--) {
      if (beat >= segs[i].startBeat) {
        return segs[i];
      }
    }
    return segs[0];
  }

  beatAt(frame: number): number {
    const seg = this.segAtFrame(frame);
    return seg.startBeat + ((frame - seg.startFrame) * seg.bpm) / (60 * this.sampleRate);
  }

  frameAt(beat: number): number {
    const seg = this.segAtBeat(beat);
    return seg.startFrame + ((beat - seg.startBeat) * 60 * this.sampleRate) / seg.bpm;
  }

  bpmAt(frame: number): number {
    return this.segAtFrame(frame).bpm;
  }

  /**
   * Returns a new map with a tempo change at `atFrame`: beat position stays continuous
   * ("re-anchor and continue"), only the slope changes from there forward.
   */
  withManualChange(atFrame: number, bpm: number): TempoMap {
    const startBeat = this.beatAt(atFrame);
    const kept = this.segments.filter(s => s.startFrame < atFrame);
    return new TempoMap(this.sampleRate, [...kept, { startBeat, startFrame: atFrame, bpm }]);
  }
}

export interface ScheduledMIDIEvent {
  beat: number;
  /** Higher types fire first at equal beat (release before attack); matches the engine heap order. */
  type: number;
  param0: number;
  param1: number;
  id: number;
}

export interface DueEvent {
  type: number;
  param0: number;
  param1: number;
  /** Sample offset within the polling consumer's current frame, in `[0, frameSize)`. */
  sampleOffset: number;
}

export interface MIDIClient {
  targetID: string;
  /** Lower bound (exclusive of prior windows) for the next poll; `null` until first poll. */
  nextBeat: number | null;
  /** Transport generation this cursor belongs to; a mismatch resets the cursor (see `Transport.reset`). */
  generation: number;
}

const cmpEvent = (a: ScheduledMIDIEvent, b: ScheduledMIDIEvent): number =>
  a.beat - b.beat || b.type - a.type || a.id - b.id;

/**
 * Holds the active tempo map and a per-target timeline of scheduled future events.  Consumers
 * poll once per render quantum with their own globally-consistent `currentFrame`, so delivery
 * does not depend on the execution order of nodes within the quantum.
 */
export class Transport {
  readonly frameSize: number;
  tempoMap: TempoMap;
  /** Bumped on every `reset` (play start/stop); clients with a stale generation drop their cursor. */
  generation = 0;
  private scheduled: Map<string, ScheduledMIDIEvent[]> = new Map();
  private immediate: Map<string, DueEvent[]> = new Map();

  constructor(tempoMap: TempoMap, frameSize = 128) {
    this.tempoMap = tempoMap;
    this.frameSize = frameSize;
  }

  beatAt(frame: number): number {
    return this.tempoMap.beatAt(frame);
  }

  frameAt(beat: number): number {
    return this.tempoMap.frameAt(beat);
  }

  bpmAt(frame: number): number {
    return this.tempoMap.bpmAt(frame);
  }

  addTarget(targetID: string): void {
    if (!this.scheduled.has(targetID)) {
      this.scheduled.set(targetID, []);
      this.immediate.set(targetID, []);
    }
  }

  createClient(targetID: string): MIDIClient {
    this.addTarget(targetID);
    return { targetID, nextBeat: null, generation: this.generation };
  }

  /**
   * Drops every queued event and bumps the generation so polling clients reset their cursors.
   * Called at play start (fresh timeline) and stop (so a later restart can't be skipped by a
   * cursor left high from the previous run).
   */
  reset(): void {
    for (const arr of this.scheduled.values()) {
      arr.length = 0;
    }
    for (const arr of this.immediate.values()) {
      arr.length = 0;
    }
    this.generation++;
  }

  scheduleMIDI(
    targetID: string,
    beat: number,
    type: number,
    param0: number,
    param1: number,
    id: number
  ): void {
    this.addTarget(targetID);
    const arr = this.scheduled.get(targetID)!;
    const evt: ScheduledMIDIEvent = { beat, type, param0, param1, id };
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cmpEvent(arr[mid], evt) < 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    arr.splice(lo, 0, evt);
  }

  insertLiveMIDI(targetID: string, type: number, param0: number, param1: number): void {
    this.addTarget(targetID);
    this.immediate.get(targetID)!.push({ type, param0, param1, sampleOffset: 0 });
  }

  cancelMIDI(ids: Iterable<number>): void {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (idSet.size === 0) {
      return;
    }
    for (const arr of this.scheduled.values()) {
      let w = 0;
      for (let r = 0; r < arr.length; r++) {
        if (!idSet.has(arr[r].id)) {
          arr[w++] = arr[r];
        }
      }
      arr.length = w;
    }
  }

  pollMIDI(client: MIDIClient, currentFrame: number): DueEvent[] {
    if (client.generation !== this.generation) {
      client.generation = this.generation;
      client.nextBeat = null;
    }

    const out: DueEvent[] = [];

    const imm = this.immediate.get(client.targetID);
    if (imm && imm.length) {
      for (let i = 0; i < imm.length; i++) {
        out.push(imm[i]);
      }
      imm.length = 0;
    }

    const windowEndBeat = this.tempoMap.beatAt(currentFrame + this.frameSize);
    const arr = this.scheduled.get(client.targetID);
    if (arr && arr.length) {
      const lowerBound = client.nextBeat ?? this.tempoMap.beatAt(currentFrame);
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid].beat < lowerBound) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      for (let i = lo; i < arr.length && arr[i].beat < windowEndBeat; i++) {
        const e = arr[i];
        let off = Math.round(this.tempoMap.frameAt(e.beat)) - currentFrame;
        if (off < 0) {
          off = 0;
        } else if (off >= this.frameSize) {
          off = this.frameSize - 1;
        }
        out.push({ type: e.type, param0: e.param0, param1: e.param1, sampleOffset: off });
      }
    }
    client.nextBeat = windowEndBeat;

    return out;
  }
}
