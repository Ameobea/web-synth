import * as R from 'ramda';

import {
  cancelAndRescheduleManyEvents,
  getUniqueCBID,
  MIDIEventType,
  postMIDIEventToAudioThread,
  registerGlobalStopCB,
  scheduleEventBeats,
  scheduleMIDIEventBeats,
  type EventToReschedule,
} from 'src/eventScheduler';
import { UnimplementedError, UnreachableError } from 'src/util';
import { type Writable, writable } from 'svelte/store';

/**
 * The set of functions that must be provided to a MIDI node that accepts input from other MIDI nodes.
 */
export interface MIDIInputCbs {
  /**
   * If this is set, then this MIDI node opts into audio thread scheduling.  This means that instead of
   * calling `onAttack` and `onRelease` directly, we will instead post a message to the audio thread
   * mailbox with the MIDI event.
   */
  enableRxAudioThreadScheduling?: { mailboxIDs: string[] };
  onAttack: (note: number, velocity: number) => void;
  onRelease: (note: number, velocity: number) => void;
  onPitchBend: (bendAmount: number) => void;
  onClearAll: () => void;
  onGenericControl?: (controlIndex: number, controlValue: number) => void;
}

export const mkBuildPasthroughInputCBs = (node: MIDINode) => (): MIDIInputCbs => ({
  onAttack: (note, velocity) => node.onAttack(note, velocity),
  onRelease: (note, velocity) => node.onRelease(note, velocity),
  onPitchBend: bendAmount => node.outputCbs.forEach(cb => cb.onPitchBend(bendAmount)),
  onClearAll: () => node.outputCbs.forEach(cbs => cbs.onClearAll()),
  onGenericControl: (controlIndex, controlValue) =>
    node.outputCbs.forEach(cbs => cbs.onGenericControl?.(controlIndex, controlValue)),
});

export type MIDIEvent =
  | { type: MIDIEventType.Attack; note: number; velocity: number }
  | { type: MIDIEventType.Release; note: number; velocity: number };

export interface MIDINoteMetadata {
  active: boolean;
  name?: string;
}

export interface MIDINodeMetadata {
  /**
   * Sparse map of MIDI numbers to metadata about that note.
   */
  noteMetadata: Map<number, MIDINoteMetadata>;
}

/**
 * A `MIDINode` is a special kind of connectable that deals with polyphonic MIDI events.  They are connectable
 * in the patch network with a connection type of 'midi'.
 */
export class MIDINode {
  protected connectedInputs: MIDINode[] = [];
  protected connectedOutputs: MIDINode[] = [];
  public getInputCbs: () => MIDIInputCbs;
  public metadata: Writable<MIDINodeMetadata> = writable({ noteMetadata: new Map() });
  private cachedInputCbs: MIDIInputCbs | null = null;
  private connectionsChangedCbs: (() => void)[] = [];

  constructor(getInputCbs?: (() => MIDIInputCbs) | undefined) {
    this.getInputCbs =
      getInputCbs ??
      (() => {
        throw new UnreachableError("MIDI node doesn't accept inputs");
      });

    registerGlobalStopCB(() => {
      this.scheduledEvents.length = 0;
    });
  }

  /**
   * Returns a function that, when called, triggers an input on this MIDI node.  Must return the exact same object
   * each time it's called.
   */
  public get inputCbs(): MIDIInputCbs {
    if (!this.cachedInputCbs) {
      this.cachedInputCbs = this.getInputCbs();
    }

    return this.cachedInputCbs!;
  }

  /**
   * Don't hold references to the array returned by this!  The array's pointer can change at any time.
   *
   * Always call this getter to get the latest instance of the output callbacks array.
   */
  public get outputCbs() {
    return this.connectedOutputs.map(node => node.inputCbs);
  }

  public connect(dst: MIDINode) {
    const inputCbs = dst.inputCbs;
    // Make sure we're not already connected
    if (this.outputCbs.find(R.equals(inputCbs))) {
      return;
    }

    this.connectedOutputs.push(dst);
    dst.connectedInputs.push(this);

    this.onConnectionsChanged();
    dst.onConnectionsChanged();
  }

  public disconnect(dst?: MIDINode) {
    if (!dst) {
      this.connectedOutputs.forEach(dst => {
        dst.connectedInputs = dst.connectedInputs.filter(node => node !== this);
        dst.onConnectionsChanged();
      });
      this.connectedOutputs.length = 0;
      this.onConnectionsChanged();
      return;
    }

    const beforeOutputCount = this.connectedOutputs.length;
    this.connectedOutputs = this.connectedOutputs.filter(node => node !== dst);

    if (beforeOutputCount === this.connectedOutputs.length) {
      console.warn("Tried to disconnect two MIDI nodes but they weren't connected");
    } else {
      dst.connectedInputs = dst.connectedInputs.filter(node => node !== this);
      dst.onConnectionsChanged();
      this.onConnectionsChanged();
    }
  }

  private onConnectionsChanged() {
    this.rescheduleEvents();

    for (const cb of this.connectionsChangedCbs) {
      cb();
    }
  }

  public registerOnConnectionsChangedCb(cb: () => void) {
    this.connectionsChangedCbs.push(cb);
  }

  /**
   * @param interactiveOnly If set, this event will only be sent to connected outputs that do not have
   * audio thread scheduling enabled.
   */
  public onAttack(note: number, velocity: number, interactiveOnly = false) {
    this.outputCbs.forEach(cbs => {
      if (cbs.enableRxAudioThreadScheduling) {
        if (interactiveOnly) {
          return;
        }

        for (const mailboxID of cbs.enableRxAudioThreadScheduling.mailboxIDs) {
          postMIDIEventToAudioThread(mailboxID, MIDIEventType.Attack, note, velocity);
        }
        return;
      }

      cbs.onAttack(note, velocity);
    });
  }

  /**
   * @param interactiveOnly If set, this event will only be sent to connected outputs that do not have
   * audio thread scheduling enabled.
   */
  public onRelease(note: number, velocity: number, interactiveOnly = false) {
    this.outputCbs.forEach(cbs => {
      if (cbs.enableRxAudioThreadScheduling) {
        if (interactiveOnly) {
          return;
        }

        for (const mailboxID of cbs.enableRxAudioThreadScheduling.mailboxIDs) {
          postMIDIEventToAudioThread(mailboxID, MIDIEventType.Release, note, velocity);
        }
        return;
      }

      cbs.onRelease(note, velocity);
    });
  }

  public clearAll() {
    this.outputCbs.forEach(cbs => {
      if (cbs.enableRxAudioThreadScheduling) {
        for (const mailboxID of cbs.enableRxAudioThreadScheduling.mailboxIDs) {
          postMIDIEventToAudioThread(mailboxID, MIDIEventType.ClearAll, 0, 0);
        }
      } else {
        cbs.onClearAll();
      }
    });
  }

  private scheduledEvents: {
    at: { type: 'beat'; beat: number } | { type: 'time'; time: number };
    evt: MIDIEvent;
    cbIDs: number[];
  }[] = [];

  get needsUIThreadScheduling() {
    return this.outputCbs.some(cbs => !cbs.enableRxAudioThreadScheduling);
  }

  get needsAudioThreadScheduling() {
    return this.outputCbs.some(cbs => !!cbs.enableRxAudioThreadScheduling);
  }

  private scheduleEventInner(
    needsUIThreadScheduling: boolean,
    needsAudioThreadScheduling: boolean,
    beat: number,
    evt: MIDIEvent
  ) {
    const cbIDs: number[] = [];

    if (needsUIThreadScheduling) {
      const cb = () => {
        const fn = {
          [MIDIEventType.Attack]: this.onAttack,
          [MIDIEventType.Release]: this.onRelease,
        }[evt.type].bind(this);
        fn(evt.note, evt.velocity, true);
      };

      cbIDs.push(scheduleEventBeats(beat, cb));
    }

    if (needsAudioThreadScheduling) {
      for (const cbs of this.outputCbs) {
        if (!cbs.enableRxAudioThreadScheduling) {
          continue;
        }

        for (const mailboxID of cbs.enableRxAudioThreadScheduling.mailboxIDs) {
          cbIDs.push(scheduleMIDIEventBeats(beat, mailboxID, evt.type, evt.note, evt.velocity));
        }
      }
    }

    return { at: { type: 'beat' as const, beat }, evt, cbIDs };
  }

  public scheduleEvent(beat: number, evt: MIDIEvent) {
    const scheduledEvent = this.scheduleEventInner(
      this.needsUIThreadScheduling,
      this.needsAudioThreadScheduling,
      beat,
      evt
    );
    this.scheduledEvents.push(scheduledEvent);
  }

  /**
   * Creates new scheduled events for all previously scheduled events to reflect new connected destinations.
   *
   * All these events will have new `cbId`s and we will forget all about the old ones since they'll either be
   * cancelled or already happened.
   */
  private rescheduleEvents() {
    if (this.scheduledEvents.length === 0) {
      return;
    }

    console.log('Rescheduling events in MIDI node', this.scheduledEvents);

    const needsUIThreadScheduling = this.needsUIThreadScheduling;
    const needsAudioThreadScheduling = this.needsAudioThreadScheduling;

    const cbIDsToCancel = this.scheduledEvents.flatMap(({ cbIDs }) => cbIDs);
    const eventsToReschedule: EventToReschedule[] = [];
    const newScheduledEvents: typeof this.scheduledEvents = [];

    for (const { at, evt } of this.scheduledEvents) {
      if (at.type !== 'beat') {
        throw new UnimplementedError();
      }

      const cbIDs: number[] = [];

      if (needsUIThreadScheduling) {
        const cbId = getUniqueCBID();
        cbIDs.push(cbId);
        eventsToReschedule.push({
          at: { type: 'beats' as const, beat: at.beat },
          cbId,
          mailboxID: null,
          midiEventType: evt.type,
          param0: evt.note,
          param1: evt.velocity,
        });
      }

      if (needsAudioThreadScheduling) {
        for (const cbs of this.outputCbs) {
          if (!cbs.enableRxAudioThreadScheduling) {
            continue;
          }

          for (const mailboxID of cbs.enableRxAudioThreadScheduling.mailboxIDs) {
            const cbId = getUniqueCBID();
            cbIDs.push(cbId);
            eventsToReschedule.push({
              at: { type: 'beats' as const, beat: at.beat },
              cbId,
              mailboxID,
              midiEventType: evt.type,
              param0: evt.note,
              param1: evt.velocity,
            });
          }
        }
      }

      const newScheduledEvent = { at, evt, cbIDs };
      newScheduledEvents.push(newScheduledEvent);
    }
    this.scheduledEvents = newScheduledEvents;

    cancelAndRescheduleManyEvents(cbIDsToCancel, eventsToReschedule);
    console.log(`Rescheduled ${eventsToReschedule.length} events`);
  }

  public setInputCbs(newGetInputCbs: () => MIDIInputCbs) {
    this.cachedInputCbs = null;
    this.getInputCbs = newGetInputCbs;

    // Tell all MIDI nodes connected to us that we've changed and that they need to re-schedule their events.
    this.connectedInputs.forEach(input => input.onConnectionsChanged());
  }
}
