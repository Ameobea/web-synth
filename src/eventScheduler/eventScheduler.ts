import { useEffect, useState } from 'react';
import { globalTempoCSN } from 'src/globalMenu/GlobalMenu';
import { genRandomStringID } from 'src/util';

let PendingEvents: { time: number | null; beats: number | null; cbId: number }[] = [];

const ctx = new AudioContext();
let SchedulerHandle: AudioWorkletNode | null = null;

let cbIdCounter = 0;
const RegisteredCbs: Map<number, () => void> = new Map();

const registerCb = (cb: () => void): number => {
  const cbId = cbIdCounter++;
  RegisteredCbs.set(cbId, cb);
  return cbId;
};

export const cancelCb = (cbId: number) => RegisteredCbs.delete(cbId);

let StartCBs: (() => void)[] = [];
let StopCBs: (() => void)[] = [];
let isStarted = false;
let lastStartTime = 0;

export const getIsGlobalBeatCounterStarted = (): boolean => isStarted;

/**
 * Registers a callback to be called when the global beat counter is started
 */
export const registerStartCB = (cb: () => void) => StartCBs.push(cb);

/**
 * Registers a callback to be called when the global beat counter is stopped
 */
export const registerStopCB = (cb: () => void) => StopCBs.push(cb);

export const unregisterStartCB = (cb: () => void) => {
  StartCBs = StartCBs.filter(ocb => ocb !== cb);
};

export const unregisterStopCB = (cb: () => void) => {
  StopCBs = StopCBs.filter(ocb => ocb !== cb);
};

export const useIsGlobalBeatCounterStarted = () => {
  const [isStarted, setIsStarted] = useState(getIsGlobalBeatCounterStarted());

  useEffect(() => {
    const startCb = () => setIsStarted(true);
    const stopCb = () => setIsStarted(false);
    registerStartCB(startCb);
    registerStopCB(stopCb);

    return () => {
      unregisterStartCB(startCb);
      unregisterStopCB(stopCb);
    };
  }, []);

  return isStarted;
};

/**
 * Starts the global beat counter loop, resetting the current beat to zero.  Until this is called, no
 * events will be processed and the global current beat will remain at zero.
 *
 * Triggers all callbacks registered with `addStartCB` to be called.
 */
export const startAll = () => {
  if (isStarted) {
    console.warn("Tried to start global beat counter, but it's already started");
    return;
  } else if (!SchedulerHandle) {
    console.error('Tried to start scheduler before it was initialized');
    return;
  }

  isStarted = true;
  lastStartTime = ctx.currentTime;
  SchedulerHandle.port.postMessage({ type: 'start' });
  scheduleEventBeats(0, () => StartCBs.forEach(cb => cb()));
};

/**
 * Stops the global beat counter loop, stopping the global beat counter and cancelling all scheduled events.
 *
 * Triggers all callbacks registered with `addStopCB` to be called.
 */
export const stopAll = () => {
  if (!SchedulerHandle) {
    console.error('Tried to stop scheduler before it was initialized');
    return;
  } else if (!isStarted) {
    console.warn("Tried to stop global beat counter, but it's not running");
    return;
  }

  isStarted = false;
  SchedulerHandle.port.postMessage({ type: 'stop' });

  for (const cbId of RegisteredCbs.keys()) {
    cancelCb(cbId);
  }
  StopCBs.forEach(cb => cb());
};

const callCb = (cbId: number) => {
  const cb = RegisteredCbs.get(cbId);
  if (!cb) {
    // Cancelled?
    return;
  }
  RegisteredCbs.delete(cbId);
  cb();
};

let beatManagerSAB: Float32Array | null = null;

/**
 * Returns the current beat of the global beat counter.  This value is updated directly from the web audio rendering thread
 * and shared with the main thread via `SharedArrayBuffer` meaning that it's quite accurate.
 */
export const getCurBeat = (): number => {
  if (!beatManagerSAB) {
    return 0;
  }
  return beatManagerSAB[0];
};

export const getCurGlobalBPM = () => {
  if (!beatManagerSAB) {
    return 0;
  }
  return beatManagerSAB[1];
};

// Init the scheduler AWP instance
Promise.all([
  fetch(
    '/event_scheduler.wasm?cacheBust=' +
      (window.location.host.includes('localhost') ? '' : genRandomStringID())
  ).then(res => res.arrayBuffer()),
  ctx.audioWorklet.addModule(
    '/EventSchedulerWorkletProcessor.js?cacheBust=' +
      (window.location.host.includes('localhost') ? '' : genRandomStringID())
  ),
] as const).then(([wasmArrayBuffer]) => {
  SchedulerHandle = new AudioWorkletNode(ctx, 'event-scheduler-audio-worklet-node-processor');
  globalTempoCSN.connect((SchedulerHandle.parameters as any).get('global_tempo_bpm'));
  SchedulerHandle.port.onmessage = evt => {
    if (typeof evt.data === 'number') {
      callCb(evt.data);
    } else if (evt.data.type === 'beatManagerSAB') {
      beatManagerSAB = evt.data.beatManagerSAB;
    } else {
      console.warn('Unhandled event manager message: ', evt.data);
    }
  };
  SchedulerHandle.port.postMessage({ type: 'init', wasmArrayBuffer });
  PendingEvents.forEach(({ time, beats, cbId }) =>
    time === null
      ? SchedulerHandle!.port.postMessage({ type: 'scheduleBeats', beats, cbId })
      : SchedulerHandle!.port.postMessage({ type: 'schedule', time, cbId })
  );
  PendingEvents = [];
});

/**
 * Schedules `cb` to be run when the global audio context `currentTime` reaches `time`.
 */
export const scheduleEventTimeAbsolute = (time: number, cb: () => void): number => {
  const cbId = registerCb(cb);
  if (!SchedulerHandle) {
    PendingEvents.push({ time, beats: null, cbId });
    return cbId;
  }

  SchedulerHandle.port.postMessage({ type: 'schedule', time, cbId });
  return cbId;
};

/**
 * Schedules `cb` to be run `time` seconds after the time the global beat counter was last started
 */
export const scheduleEventTimeRelativeToStart = (time: number, cb: () => void): number =>
  scheduleEventTimeAbsolute(time - lastStartTime, cb);

/**
 * Schedules `cb` to be run `time` seconds from the current time
 */
export const scheduleEventTimeRelativeToCurTime = (
  secondsFromNow: number,
  cb: () => void
): number => scheduleEventTimeAbsolute(ctx.currentTime + secondsFromNow, cb);

export const scheduleEventBeats = (beats: number, cb: () => void): number => {
  const cbId = registerCb(cb);
  if (!SchedulerHandle) {
    PendingEvents.push({ time: null, beats, cbId });
    return cbId;
  }

  SchedulerHandle.port.postMessage({ type: 'scheduleBeats', beats, cbId });
  return cbId;
};

/**
 * @param beatsFromNow When to start the even, in beats, from the current beat
 */
export const scheduleEventBeatsRelative = (beatsFromNow: number, cb: () => void): number => {
  const cbId = registerCb(cb);
  if (!SchedulerHandle) {
    PendingEvents.push({ time: null, beats: 0, cbId });
    return cbId;
  }

  SchedulerHandle.port.postMessage({ type: 'scheduleBeatsRelative', beatsFromNow, cbId });
  return cbId;
};
