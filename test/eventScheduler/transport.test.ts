import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TempoMap, Transport, type MIDIClient } from '../../src/eventScheduler/transport.ts';

const SR = 44100;
const FRAME = 128;

/** Drive a client through contiguous quanta `[0, endFrame]`, returning every delivered event tagged with its frame. */
const playThrough = (
  t: Transport,
  client: MIDIClient,
  endFrame: number
): { frame: number; type: number; param0: number; sampleOffset: number }[] => {
  const delivered: { frame: number; type: number; param0: number; sampleOffset: number }[] = [];
  for (let f = 0; f <= endFrame; f += FRAME) {
    for (const e of t.pollMIDI(client, f)) {
      delivered.push({ frame: f, type: e.type, param0: e.param0, sampleOffset: e.sampleOffset });
    }
  }
  return delivered;
};

test('TempoMap: beat/frame round-trip and known values', () => {
  const tm = TempoMap.constant(SR, 120); // 120bpm => 2 beats/sec
  assert.equal(tm.beatAt(0), 0);
  assert.ok(Math.abs(tm.beatAt(SR) - 2) < 1e-9);
  assert.ok(Math.abs(tm.frameAt(2) - SR) < 1e-6);
  for (const b of [0, 0.25, 1, 3.7, 64]) {
    assert.ok(Math.abs(tm.beatAt(tm.frameAt(b)) - b) < 1e-9);
  }
  assert.equal(tm.bpmAt(123456), 120);
});

test('TempoMap: manual change is continuous and changes slope going forward', () => {
  const tm = TempoMap.constant(SR, 120);
  const changeFrame = SR; // 1s in, at beat 2
  const tm2 = tm.withManualChange(changeFrame, 60); // half speed from here
  assert.ok(Math.abs(tm2.beatAt(changeFrame) - tm.beatAt(changeFrame)) < 1e-9); // continuity
  assert.ok(Math.abs(tm2.beatAt(SR / 2) - 1) < 1e-9); // before: old slope
  assert.ok(Math.abs(tm2.beatAt(2 * SR) - 3) < 1e-9); // after: +1 beat over the next second
  assert.equal(tm2.bpmAt(2 * SR), 60);
});

test('fromTempoChanges: single change matches a constant map', () => {
  const a = TempoMap.fromTempoChanges(SR, [{ beat: 0, bpm: 120 }], 0, 0);
  const b = TempoMap.constant(SR, 120);
  for (const f of [0, 1000, SR, 3 * SR]) {
    assert.ok(Math.abs(a.beatAt(f) - b.beatAt(f)) < 1e-9);
  }
});

test('fromTempoChanges: anchored at frame 0, segments are continuous and beat-correct', () => {
  // 120bpm for [0,4), then 60bpm. Beat 4 @ 120bpm is 2s in => frame 2*SR.
  const tm = TempoMap.fromTempoChanges(SR, [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 60 }], 0, 0);
  assert.equal(tm.beatAt(0), 0);
  assert.ok(Math.abs(tm.frameAt(4) - 2 * SR) < 1e-6);
  assert.ok(Math.abs(tm.beatAt(2 * SR) - 4) < 1e-9); // boundary continuity
  // After the change at 60bpm (1 beat/sec): one more second => beat 5
  assert.ok(Math.abs(tm.beatAt(3 * SR) - 5) < 1e-9);
  assert.equal(tm.bpmAt(2 * SR + 1), 60);
});

test('fromTempoChanges: anchoring keeps the current beat continuous (mid-playback edit)', () => {
  const changes = [{ beat: 0, bpm: 120 }, { beat: 8, bpm: 90 }];
  // Pretend we are mid-playback at beat 5, frame 123456; an edit rebuilds anchored there.
  const tm = TempoMap.fromTempoChanges(SR, changes, 5, 123456);
  assert.ok(Math.abs(tm.beatAt(123456) - 5) < 1e-9);
  // The downstream tempo change still occurs at beat 8 with the right slope.
  assert.equal(tm.bpmAt(tm.frameAt(8) + 1), 90);
  assert.ok(Math.abs(tm.beatAt(tm.frameAt(8)) - 8) < 1e-9);
});

test('pollMIDI: each event delivered exactly once, in the quantum containing its beat, at the right offset', () => {
  const tm = TempoMap.constant(SR, 120);
  const t = new Transport(tm, FRAME);
  const c = t.createClient('synthA');
  t.scheduleMIDI('synthA', 2, 0, 64, 90, 1); // attack at beat 2 (== frame 44100)

  const targetFrame = tm.frameAt(2);
  const delivered = playThrough(t, c, SR + FRAME);

  assert.equal(delivered.length, 1);
  const [e] = delivered;
  assert.ok(e.frame <= targetFrame && targetFrame < e.frame + FRAME, 'wrong quantum');
  assert.equal(e.sampleOffset, Math.round(targetFrame) - e.frame);
  assert.equal(e.param0, 64);
});

test('pollMIDI: at equal beat, higher event types deliver first (release before attack)', () => {
  const tm = TempoMap.constant(SR, 120);
  const t = new Transport(tm, FRAME);
  const c = t.createClient('s');
  t.scheduleMIDI('s', 4, 0, 60, 90, 1); // attack
  t.scheduleMIDI('s', 4, 1, 60, 0, 2); // release
  t.scheduleMIDI('s', 4, 3, 0, 0, 3); // clearAll

  const types = playThrough(t, c, tm.frameAt(4) + FRAME).map(e => e.type);
  assert.deepEqual(types, [3, 1, 0]);
});

test('pollMIDI: simultaneous events on different targets land in the same quantum regardless of poll order', () => {
  const tm = TempoMap.constant(SR, 120);
  const t = new Transport(tm, FRAME);
  const a = t.createClient('A');
  const b = t.createClient('B');
  t.scheduleMIDI('A', 8, 0, 60, 90, 1);
  t.scheduleMIDI('B', 8, 0, 67, 90, 2);

  let aHit = { frame: -1, off: -1 };
  let bHit = { frame: -1, off: -1 };
  const endFrame = tm.frameAt(8) + FRAME;
  // Alternate which client polls first each quantum to prove delivery is order-independent.
  for (let f = 0, i = 0; f <= endFrame; f += FRAME, i++) {
    const [first, firstHit, second, secondHit] =
      i % 2 === 0 ? [a, aHit, b, bHit] : [b, bHit, a, aHit];
    for (const e of t.pollMIDI(first, f)) {
      firstHit.frame = f;
      firstHit.off = e.sampleOffset;
    }
    for (const e of t.pollMIDI(second, f)) {
      secondHit.frame = f;
      secondHit.off = e.sampleOffset;
    }
  }

  assert.notEqual(aHit.frame, -1);
  assert.equal(aHit.frame, bHit.frame);
  assert.equal(aHit.off, bHit.off);
});

test('cancelMIDI: removes only the named events', () => {
  const tm = TempoMap.constant(SR, 120);
  const t = new Transport(tm, FRAME);
  const c = t.createClient('s');
  t.scheduleMIDI('s', 4, 0, 60, 90, 1);
  t.scheduleMIDI('s', 4, 0, 64, 90, 2);
  t.cancelMIDI([1]);

  const notes = playThrough(t, c, tm.frameAt(4) + FRAME).map(e => e.param0);
  assert.deepEqual(notes, [64]);
});

test('reset: after a restart, a client cursor left high does not skip freshly scheduled events', () => {
  const tm = TempoMap.constant(SR, 120);
  const t = new Transport(tm, FRAME);
  const c = t.createClient('s');

  // First run: schedule + consume an event at beat 8, advancing the cursor well past it.
  t.scheduleMIDI('s', 8, 0, 60, 90, 1);
  assert.equal(playThrough(t, c, tm.frameAt(8) + FRAME).length, 1);

  // Stop/start clears the timeline and bumps the generation.
  t.reset();
  t.scheduleMIDI('s', 2, 0, 67, 90, 2); // earlier beat than the (now-stale) cursor

  const delivered = playThrough(t, c, tm.frameAt(2) + FRAME);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].param0, 67);
});

test('insertLiveMIDI: delivered on the next poll at offset 0', () => {
  const t = new Transport(TempoMap.constant(SR, 120), FRAME);
  const c = t.createClient('s');
  t.pollMIDI(c, 0);
  t.insertLiveMIDI('s', 0, 72, 100);

  const due = t.pollMIDI(c, FRAME);
  assert.equal(due.length, 1);
  assert.equal(due[0].param0, 72);
  assert.equal(due[0].sampleOffset, 0);
});
