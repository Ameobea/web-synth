import {
  getCurGlobalBPM,
  registerGlobalStartCB,
  registerGlobalStopCB,
  setTempoChanges as pushTempoChangesToClock,
} from 'src/eventScheduler';
import type { TempoChange } from 'src/eventScheduler/transport';
import {
  bpmAtBeat,
  deleteTempoChange,
  normalizeTempoChanges,
  upsertTempoChange,
} from 'src/globalMenu/tempoChanges';
import { rwritable, type TransparentWritable } from 'src/util';

const ctx = new AudioContext();

const DEFAULT_BPM = 120;

/**
 * Readable BPM output for the `BPMNode` and tempo-synced consumers.  Reflects the base tempo while
 * stopped and follows the active tempo segment during playback (see the live-follow loop below);
 * BPM is no longer written into the audio graph.
 */
export const globalTempoCSN = new ConstantSourceNode(ctx);
(window as any).globalTempoCSN = globalTempoCSN;
globalTempoCSN.start();

const loadFromLocalStorage = (): TempoChange[] => {
  const raw = localStorage?.getItem('tempoChanges');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return normalizeTempoChanges(parsed);
      }
    } catch (err) {
      console.warn('Failed to parse `tempoChanges` from localStorage; using `globalTempo`', err);
    }
  }
  return normalizeTempoChanges([
    { beat: 0, bpm: +(localStorage?.getItem('globalTempo') ?? DEFAULT_BPM) },
  ]);
};

/** Source of truth for composition tempo.  Subscribe for reactive UIs; `.current` for sync reads. */
export const tempoChangesStore: TransparentWritable<TempoChange[]> = rwritable(loadFromLocalStorage());

let followingLiveTempo = false;

const publish = (changes: TempoChange[]) => {
  const baseBpm = changes[0].bpm;
  if (!followingLiveTempo) {
    globalTempoCSN.offset.value = baseBpm;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.globalTempo = baseBpm.toFixed(1);
    localStorage.tempoChanges = JSON.stringify(changes);
  }
  pushTempoChangesToClock(changes);
};

// Fires immediately with the initial value (Svelte store semantics), so the initial publish happens here.
tempoChangesStore.subscribe(publish);

// While playing, track the tempo of the active segment so BPM-synced consumers follow automation.
// The worklet writes the live bpm to the beat-manager SAB each quantum; we mirror it onto the CSN.
const tickLiveTempo = () => {
  if (!followingLiveTempo) {
    return;
  }
  const bpm = getCurGlobalBPM();
  if (bpm > 0) {
    globalTempoCSN.offset.value = bpm;
  }
  requestAnimationFrame(tickLiveTempo);
};

registerGlobalStartCB(() => {
  if (typeof requestAnimationFrame !== 'function') {
    return;
  }
  if (!followingLiveTempo) {
    followingLiveTempo = true;
    requestAnimationFrame(tickLiveTempo);
  }
});

registerGlobalStopCB(() => {
  followingLiveTempo = false;
  globalTempoCSN.offset.value = tempoChangesStore.current[0].bpm;
});

export const getTempoChanges = (): TempoChange[] => tempoChangesStore.current;

export const setTempoChanges = (changes: TempoChange[]) => {
  tempoChangesStore.set(normalizeTempoChanges(changes));
};

export const addOrUpdateTempoChange = (beat: number, bpm: number) => {
  tempoChangesStore.set(upsertTempoChange(tempoChangesStore.current, beat, bpm));
};

export const removeTempoChange = (beat: number) => {
  tempoChangesStore.set(deleteTempoChange(tempoChangesStore.current, beat));
};

/** Tempo in effect at `beat` per the current change list (used to default a newly-added flag). */
export const getBpmAtBeat = (beat: number): number => bpmAtBeat(tempoChangesStore.current, beat);

/**
 * Applies the tempo stored in a composition body on load.  The body is authoritative: prefer its
 * `tempoChanges`, fall back to the legacy `globalTempo` scalar, and full-replace the registry so a
 * stale `tempoChanges` left in `localStorage` by a prior composition can't shadow it.
 */
export const loadTempoFromComposition = (body: { [key: string]: unknown }) => {
  let changes: TempoChange[] | null = null;

  if (typeof body.tempoChanges === 'string') {
    try {
      const parsed = JSON.parse(body.tempoChanges);
      if (Array.isArray(parsed) && parsed.length > 0) {
        changes = parsed;
      }
    } catch (err) {
      console.warn('Failed to parse `tempoChanges` from composition; using `globalTempo`', err);
    }
  }

  if (!changes && (typeof body.globalTempo === 'string' || typeof body.globalTempo === 'number')) {
    changes = [{ beat: 0, bpm: +body.globalTempo }];
  }

  // Reset to default when the composition carries no tempo so a prior composition's tempo can't
  // bleed across the switch and get saved into the new one.
  setTempoChanges(changes ?? [{ beat: 0, bpm: DEFAULT_BPM }]);
};

export const getGlobalBpm = () => tempoChangesStore.current[0].bpm;

export const setGlobalBpm = (newGlobalTempo: number) => {
  addOrUpdateTempoChange(0, newGlobalTempo);
};
