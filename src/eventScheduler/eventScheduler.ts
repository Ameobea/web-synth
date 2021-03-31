import { globalTempoCSN } from 'src/globalMenu/GlobalMenu';

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

const callCb = (cbId: number) => {
  const cb = RegisteredCbs.get(cbId);
  if (!cb) {
    // Cancelled?
    return;
  }
  RegisteredCbs.delete(cbId);
  cb();
};

// Init the scheduler AWP instance
Promise.all([
  fetch('/event_scheduler.wasm').then(res => res.arrayBuffer()),
  ctx.audioWorklet.addModule('/EventSchedulerWorkletProcessor.js'),
] as const).then(([wasmArrayBuffer]) => {
  SchedulerHandle = new AudioWorkletNode(ctx, 'event-scheduler-audio-worklet-node-processor');
  globalTempoCSN.connect((SchedulerHandle.parameters as any).get('global_tempo_bpm'));
  SchedulerHandle.port.onmessage = evt => {
    if (typeof evt.data === 'number') {
      callCb(evt.data);
    } else {
      // console.log(evt.data);
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

export const scheduleEvent = (time: number, cb: () => void): number => {
  const cbId = registerCb(cb);
  if (!SchedulerHandle) {
    PendingEvents.push({ time, beats: null, cbId });
    return cbId;
  }

  SchedulerHandle.port.postMessage({ type: 'schedule', time, cbId });
  return cbId;
};

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
