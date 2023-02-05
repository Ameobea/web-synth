import { UnimplementedError, UnreachableException } from 'ameo-utils';
import { useEffect, useState } from 'react';

import { globalTempoCSN } from 'src/globalMenu/GlobalMenu';
import { genRandomStringID } from 'src/util';

export enum MIDIEventType {
  Attack,
  Release,
  PitchBend,
  ClearAll,
  GenericControl,
}

type PendingEvent =
  | {
      type: 'schedule';
      time: number | null;
      beats: number | null;
      payload:
        | { type: 'cbId'; cbId: number }
        | {
            type: 'midi';
            mailboxID: string;
            eventType: MIDIEventType;
            param0: number;
            param1: number;
            cbId: number;
          };
    }
  | {
      type: 'interactiveMIDIEvent';
      mailboxID: string;
      eventType: MIDIEventType;
      param0: number;
      param1: number;
    };

let PendingEvents: PendingEvent[] = [];

const ctx = new AudioContext();
let SchedulerHandle: AudioWorkletNode | null = null;

let cbIdCounter = 1;
const RegisteredCbs: Map<number, () => void> = new Map();

export const getUniqueCBID = () => cbIdCounter++;

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
    process.env.ASSET_PATH +
      'event_scheduler.wasm?cacheBust=' +
      (window.location.host.includes('localhost') ? '' : genRandomStringID())
  ).then(res => res.arrayBuffer()),
  ctx.audioWorklet.addModule(
    process.env.ASSET_PATH +
      'EventSchedulerWorkletProcessor.js?cacheBust=' +
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
  PendingEvents.forEach(evt => {
    if (evt.type === 'schedule') {
      const { time, beats, payload } = evt;
      if (time === null) {
        if (payload.type === 'midi') {
          SchedulerHandle!.port.postMessage({
            type: 'scheduleBeats',
            beats,
            cbId: payload.cbId,
            mailboxID: payload.mailboxID,
            midiEventtype: payload.eventType,
            param0: payload.param0,
            param1: payload.param1,
          });
        } else {
          SchedulerHandle!.port.postMessage({ type: 'scheduleBeats', beats, cbId: payload.cbId });
        }
      } else {
        if (payload.type === 'midi') {
          throw new UnimplementedError();
        }
        SchedulerHandle!.port.postMessage({ type: 'schedule', time, cbId: payload.cbId });
      }
    } else if (evt.type === 'interactiveMIDIEvent') {
      const { eventType, param0, param1 } = evt;
      SchedulerHandle!.port.postMessage({ type: 'postMIDIEvent', eventType, param0, param1 });
    } else {
      throw new UnreachableException();
    }
  });
  PendingEvents = [];
});

/**
 * Schedules `cb` to be run when the global audio context `currentTime` reaches `time`.
 */
export const scheduleEventTimeAbsolute = (time: number, cb: () => void): number => {
  const cbId = registerCb(cb);
  if (!SchedulerHandle) {
    PendingEvents.push({ type: 'schedule', time, beats: null, payload: { type: 'cbId', cbId } });
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
    PendingEvents.push({ type: 'schedule', time: null, beats, payload: { type: 'cbId', cbId } });
    return cbId;
  }

  SchedulerHandle.port.postMessage({ type: 'scheduleBeats', beats, cbId });
  return cbId;
};

export const scheduleMIDIEventBeats = (
  beats: number,
  mailboxID: string,
  eventType: MIDIEventType,
  param0: number,
  param1: number
): number => {
  const cbId = cbIdCounter++;
  if (!SchedulerHandle) {
    PendingEvents.push({
      type: 'schedule',
      time: null,
      beats,
      payload: { type: 'midi', mailboxID, eventType, param0, param1, cbId },
    });
    return cbId;
  }

  SchedulerHandle.port.postMessage({
    type: 'scheduleBeats',
    cbId,
    beats,
    mailboxID,
    midiEventType: eventType,
    param0,
    param1,
  });
  return cbId;
};

/**
 * @param beatsFromNow When to start the even, in beats, from the current beat
 */
export const scheduleEventBeatsRelative = (beatsFromNow: number, cb: () => void): number => {
  const cbId = registerCb(cb);
  if (!SchedulerHandle) {
    PendingEvents.push({ type: 'schedule', time: null, beats: 0, payload: { type: 'cbId', cbId } });
    return cbId;
  }

  SchedulerHandle.port.postMessage({ type: 'scheduleBeatsRelative', beatsFromNow, cbId });
  return cbId;
};

export const postMIDIEventToAudioThread = (
  mailboxID: string,
  eventType: MIDIEventType,
  param0: number,
  param1: number
) => {
  if (!SchedulerHandle) {
    PendingEvents.push({ type: 'interactiveMIDIEvent', mailboxID, eventType, param0, param1 });
    return;
  }

  SchedulerHandle.port.postMessage({ type: 'postMIDIEvent', mailboxID, eventType, param0, param1 });
};

export interface EventToReschedule {
  at: { type: 'time'; time: number } | { type: 'beats'; beat: number };
  cbId: number;
  mailboxID: string | null;
  midiEventType: number | null | undefined;
  param0: number;
  param1: number;
}

export const cancelAndRescheduleManyEvents = (
  cbIDsToCancel: number[],
  newEvents: EventToReschedule[]
) => {
  if (!SchedulerHandle) {
    console.error('cancelAndRescheduleManyEvents called before scheduler initialized');
    return;
  }

  const curBeat = getCurBeat() - 4;
  newEvents = newEvents.filter(evt => {
    if (evt.at.type === 'beats' && evt.at.beat < curBeat) {
      return false;
    }
    return true;
  });

  SchedulerHandle.port.postMessage({
    type: 'cancelAndRescheduleMany',
    cancelledCbIDs: cbIDsToCancel,
    newEvents,
  });
};
