let pendingEvents: { time: number; cb: () => void }[] = [];

const ctx = new AudioContext();
let schedulerHandle: AudioWorkletNode | null = null;

let cbIdCounter = 0;
const registeredCbs: Map<number, () => void> = new Map();

const registerCb = (cb: () => void): number => {
  const cbId = cbIdCounter++;
  registeredCbs.set(cbId, cb);
  return cbId;
};

const callCb = (cbId: number) => {
  const cb = registeredCbs.get(cbId);
  if (!cb) {
    // Cancelled?
    return;
  }
  registeredCbs.delete(cbId);
  cb();
};

const globalTempoCSN = new ConstantSourceNode(ctx);
globalTempoCSN.offset.value = +(localStorage.getItem('globalTempo') ?? 120);
globalTempoCSN.start();

// Init the scheduler AWP instance
Promise.all([
  fetch('/event_scheduler.wasm').then(res => res.arrayBuffer()),
  ctx.audioWorklet.addModule('/EventSchedulerWorkletProcessor.js'),
] as const).then(([wasmArrayBuffer]) => {
  schedulerHandle = new AudioWorkletNode(ctx, 'event-scheduler-audio-worklet-node-processor');
  globalTempoCSN.connect((schedulerHandle.parameters as any).get('global_tempo_bpm'));
  schedulerHandle.port.onmessage = evt => callCb(evt.data);
  schedulerHandle.port.postMessage({ type: 'init', wasmArrayBuffer });
  pendingEvents.forEach(({ time, cb }) => scheduleEvent(time, cb));
  pendingEvents = [];
});

export const scheduleEvent = (time: number, cb: () => void) => {
  if (!schedulerHandle) {
    pendingEvents.push({ time, cb });
    return;
  }

  const cbId = registerCb(cb);
  schedulerHandle.port.postMessage({ type: 'schedule', time, cbId });
};
