// Pure, environment-free helpers for manipulating a composition's tempo-change list.  Kept
// separate from `globalTempo.ts` (which instantiates Web Audio nodes at module load) so this
// logic can be unit-tested under `node:test`.

import type { TempoChange } from 'src/eventScheduler/transport';

const EPS = 1e-9;

const sameBeat = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

export const sortTempoChanges = (changes: TempoChange[]): TempoChange[] =>
  [...changes].sort((a, b) => a.beat - b.beat);

/** Sorted ascending, de-duplicated by beat (last wins), and guaranteed a base entry at beat 0. */
export const normalizeTempoChanges = (changes: TempoChange[]): TempoChange[] => {
  const sorted = sortTempoChanges(changes.length > 0 ? changes : [{ beat: 0, bpm: 120 }]);
  const deduped: TempoChange[] = [];
  for (const c of sorted) {
    const prev = deduped[deduped.length - 1];
    if (prev && sameBeat(prev.beat, c.beat)) {
      deduped[deduped.length - 1] = c;
    } else {
      deduped.push(c);
    }
  }
  if (deduped[0].beat > EPS) {
    return [{ beat: 0, bpm: deduped[0].bpm }, ...deduped];
  }
  // Snap a near-zero base exactly onto beat 0.
  deduped[0] = { beat: 0, bpm: deduped[0].bpm };
  return deduped;
};

/** The tempo in effect at `beat`: the bpm of the nearest change at or before it. */
export const bpmAtBeat = (changes: TempoChange[], beat: number): number => {
  const sorted = normalizeTempoChanges(changes);
  let bpm = sorted[0].bpm;
  for (const c of sorted) {
    if (c.beat <= beat + EPS) {
      bpm = c.bpm;
    } else {
      break;
    }
  }
  return bpm;
};

/** Inserts a change at `beat`, replacing any existing change at that beat. */
export const upsertTempoChange = (
  changes: TempoChange[],
  beat: number,
  bpm: number
): TempoChange[] => normalizeTempoChanges([...changes.filter(c => !sameBeat(c.beat, beat)), { beat, bpm }]);

/** Removes the change at `beat`.  The base entry at beat 0 cannot be removed. */
export const deleteTempoChange = (changes: TempoChange[], beat: number): TempoChange[] => {
  if (sameBeat(beat, 0)) {
    return normalizeTempoChanges(changes);
  }
  return normalizeTempoChanges(changes.filter(c => !sameBeat(c.beat, beat)));
};
