import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bpmAtBeat,
  deleteTempoChange,
  normalizeTempoChanges,
  upsertTempoChange,
} from '../../src/globalMenu/tempoChanges.ts';

test('normalize: sorts, ensures a beat-0 base, and de-dupes by beat (last wins)', () => {
  const out = normalizeTempoChanges([
    { beat: 8, bpm: 140 },
    { beat: 4, bpm: 100 },
    { beat: 4, bpm: 110 },
  ]);
  assert.deepEqual(out, [
    { beat: 0, bpm: 110 },
    { beat: 4, bpm: 110 },
    { beat: 8, bpm: 140 },
  ]);
});

test('normalize: an empty list yields a single 120bpm base', () => {
  assert.deepEqual(normalizeTempoChanges([]), [{ beat: 0, bpm: 120 }]);
});

test('upsert: adds a new change and replaces one at the same beat', () => {
  const base = normalizeTempoChanges([{ beat: 0, bpm: 120 }]);
  const added = upsertTempoChange(base, 4, 150);
  assert.deepEqual(added, [
    { beat: 0, bpm: 120 },
    { beat: 4, bpm: 150 },
  ]);
  const replaced = upsertTempoChange(added, 4, 90);
  assert.deepEqual(replaced, [
    { beat: 0, bpm: 120 },
    { beat: 4, bpm: 90 },
  ]);
});

test('upsert at beat 0 replaces the base tempo', () => {
  const out = upsertTempoChange([{ beat: 0, bpm: 120 }], 0, 180);
  assert.deepEqual(out, [{ beat: 0, bpm: 180 }]);
});

test('delete: removes a change but never the beat-0 base', () => {
  const changes = [
    { beat: 0, bpm: 120 },
    { beat: 4, bpm: 150 },
  ];
  assert.deepEqual(deleteTempoChange(changes, 4), [{ beat: 0, bpm: 120 }]);
  // Deleting the base is a no-op (still normalized).
  assert.deepEqual(deleteTempoChange(changes, 0), changes);
});

test('bpmAtBeat: returns the tempo of the nearest change at or before the beat', () => {
  const changes = [
    { beat: 0, bpm: 120 },
    { beat: 4, bpm: 150 },
    { beat: 8, bpm: 90 },
  ];
  assert.equal(bpmAtBeat(changes, 0), 120);
  assert.equal(bpmAtBeat(changes, 3.9), 120);
  assert.equal(bpmAtBeat(changes, 4), 150);
  assert.equal(bpmAtBeat(changes, 7), 150);
  assert.equal(bpmAtBeat(changes, 100), 90);
});
