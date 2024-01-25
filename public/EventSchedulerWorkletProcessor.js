// Mailbox Layout:
//
// Ring buffer that contains a sequence of MIDI events.
//
// Each event has the following format:
//
// [0] = event type enum
// [1] = (generic param 1)
// [2] = (generic param 2)
// [3] = sample index within current frame

class MIDIEventMailboxRegistry {
  constructor() {
    this.mailboxes = new Map();
    this.IDByIndex = new Map();
    this.indexByID = new Map();
  }

  addMailbox(id) {
    const buffer = new Float32Array(1024 * 256 * 4);
    const mailbox = { startIx: 0, endIx: 0, f32: buffer, u32: new Uint32Array(buffer.buffer) };
    this.mailboxes.set(id, mailbox);
    const index = this.mailboxes.size - 1;
    this.IDByIndex.set(index, id);
    this.indexByID.set(id, index);
  }

  getMailboxIndex(id) {
    return this.indexByID.get(id);
  }

  getMailboxID(index) {
    return this.IDByIndex.get(index);
  }

  submitEvent(id, eventType, param1, param2, sampleIx) {
    const mailbox = this.mailboxes.get(id);
    if (!mailbox) {
      console.error(`Tried to submit event to unknown mailbox: ${id}`);
      return;
    }

    const ix = mailbox.endIx;
    mailbox.u32[ix] = eventType;
    mailbox.f32[ix + 1] = param1;
    mailbox.f32[ix + 2] = param2;
    mailbox.u32[ix + 3] = sampleIx;
    mailbox.endIx = (ix + 4) % mailbox.f32.length;
  }

  getEvent(mailboxID) {
    const mailbox = this.mailboxes.get(mailboxID);
    if (!mailbox) {
      console.error(`Tried to get event from unknown mailbox: ${mailboxID}`);
      return;
    }

    if (mailbox.startIx === mailbox.endIx) {
      return null;
    }

    const ix = mailbox.startIx;
    const eventType = mailbox.u32[ix];
    const param1 = mailbox.f32[ix + 1];
    const param2 = mailbox.f32[ix + 2];
    const sampleIx = mailbox.u32[ix + 3];
    mailbox.startIx = (ix + 4) % mailbox.f32.length;
    return { eventType, param1, param2, sampleIx };
  }
}

globalThis.midiEventMailboxRegistry = new MIDIEventMailboxRegistry();

class EventSchedulerWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'global_tempo_bpm',
        defaultValue: 0,
        minValue: 0,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    globalThis.curBeat = 0;
    if (typeof SharedArrayBuffer !== 'undefined') {
      this.beatManagerSABInner = new SharedArrayBuffer(1024);
      this.beatManagerSAB = new Float64Array(this.beatManagerSABInner);
    }
    this.port.postMessage({ type: 'beatManagerSAB', beatManagerSAB: this.beatManagerSAB });

    this.pendingEvents = [];
    this.lastRecordedTime = 0;
    this.isStarted = false;

    this.port.onmessage = event => {
      switch (event.data.type) {
        case 'init': {
          this.initWasm(event.data.wasmArrayBuffer);
          break;
        }
        case 'start': {
          if (!this.wasmInstance) {
            console.error('Tried to start event scheduler before Wasm initialized');
            break;
          }

          globalThis.curBeat = event.data.startBeat;
          this.lastRecordedTime = currentTime;
          globalThis.globalBeatCounterStarted = true;
          this.isStarted = true;
          break;
        }
        case 'stop': {
          if (!this.wasmInstance) {
            console.error('Tried to stop event scheduler before Wasm initialized');
            break;
          }

          globalThis.globalBeatCounterStarted = false;
          this.wasmInstance.exports.stop();
          this.isStarted = false;
          break;
        }
        case 'schedule': {
          this.scheduleEvent(event.data.time, event.data.cbId);
          break;
        }
        case 'scheduleBeats': {
          this.scheduleEventBeats(
            event.data.beats,
            event.data.cbId,
            event.data.mailboxID,
            event.data.midiEventType,
            event.data.param0,
            event.data.param1
          );
          break;
        }
        case 'cancelAndRescheduleMany': {
          if (!this.wasmInstance) {
            console.error('Tried to cancel and reschedule events before Wasm initialized');
            break;
          }

          const { cancelledCbIDs, newEvents } = event.data;
          const idsBufPtr = this.wasmInstance.exports.alloc_ids_buffer(cancelledCbIDs.length);
          const idsBuf = new Int32Array(
            this.wasmInstance.exports.memory.buffer,
            idsBufPtr,
            cancelledCbIDs.length
          );
          for (let i = 0; i < cancelledCbIDs.length; i++) {
            idsBuf[i] = cancelledCbIDs[i];
          }
          const actuallyCancelledCount = this.wasmInstance.exports.cancel_events_by_ids();
          console.log(
            `Cancelled ${actuallyCancelledCount}/${cancelledCbIDs.length} events`,
            idsBuf
          );

          this.scheduleAllEventsAfterCurrentTimeOrBeat(newEvents);
          break;
        }
        case 'scheduleBeatsRelative': {
          this.scheduleEventBeats(globalThis.curBeat + event.data.beatsFromNow, event.data.cbId);
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        case 'postMIDIEvent': {
          globalThis.midiEventMailboxRegistry.submitEvent(
            event.data.mailboxID,
            event.data.eventType,
            event.data.param0,
            event.data.param1,
            0
          );
          break;
        }
        default: {
          console.error(`Unhandled message type: ${event.data.type}`);
        }
      }
    };
  }

  async initWasm(arrayBuffer) {
    const compiledModule = await WebAssembly.compile(arrayBuffer);
    this.wasmInstance = new WebAssembly.Instance(compiledModule, {
      env: {
        debug1: v => console.log(v),
        run_callback: val => this.port.postMessage(val),
        run_midi_callback: (mailboxIx, midiEventType, param0, param1) => {
          const mailboxID = globalThis.midiEventMailboxRegistry.getMailboxID(mailboxIx);
          if (!mailboxID) {
            console.error(`Tried to run MIDI callback for unknown mailbox: ${mailboxIx}`);
            return;
          }

          globalThis.midiEventMailboxRegistry.submitEvent(
            mailboxID,
            midiEventType,
            param0,
            param1,
            0
          );
        },
      },
    });

    // Schedule any events that we missed while the Wasm instance was initializing
    this.pendingEvents.forEach(event =>
      event.time === null
        ? this.scheduleBeatEvent(event.beat, event.cbId)
        : this.scheduleEvent(event.time, event.cbId)
    );
    this.pendingEvents = null;
  }

  /**
   * @param {Array<{ at: {type: 'time'; time: number} | {type: 'beats'; beat: number}; cbId: number; mailboxID: string|null; midiEventType: number | null | undefined; param0: number; param1: number }>} events
   */
  scheduleAllEventsAfterCurrentTimeOrBeat(events) {
    const curBeat = globalThis.curBeat;
    const currentTime = this.lastRecordedTime;

    let scheduledCount = 0;
    for (const event of events) {
      if (event.at.type === 'beats' && event.at.beat >= curBeat) {
        this.scheduleEventBeats(
          event.at.beat,
          event.cbId,
          event.mailboxID,
          event.midiEventType,
          event.param0,
          event.param1
        );
        scheduledCount += 1;
      } else if (event.at.type === 'time' && event.at.time >= currentTime) {
        this.scheduleEvent(event.at.time, event.cbId);
        scheduledCount += 1;
      }
    }

    console.log(`Scheduled ${scheduledCount}/${events.length} events`);
  }

  scheduleEvent(time, cbId) {
    if (!this.wasmInstance) {
      this.pendingEvents.push({ time, beats: null, cbId });
      return;
    }

    this.wasmInstance.exports.schedule(time, cbId);
  }

  scheduleEventBeats(beats, cbId, mailboxID, midiEventType, param0, param1) {
    if (!this.wasmInstance) {
      this.pendingEvents.push({ time: null, beats, cbId });
      return;
    }

    let mailboxIx = -1;
    if (mailboxID) {
      mailboxIx = globalThis.midiEventMailboxRegistry.getMailboxIndex(mailboxID);
      if (mailboxIx === null) {
        console.error(`Tried to schedule event with unknown mailbox: ${mailboxID}`);
        return;
      }
    }

    this.wasmInstance.exports.schedule_beats(beats, cbId, mailboxIx, midiEventType, param0, param1);
  }

  updateGlobalBeats(globalTempoBPM) {
    globalThis.globalTempoBPM = globalTempoBPM;
    if (this.beatManagerSAB) {
      globalThis.curBeat = this.beatManagerSAB[0];
    }

    if (this.isStarted) {
      const passedTime = currentTime - this.lastRecordedTime;
      const passedBeats = (globalTempoBPM / 60) * passedTime;
      this.lastRecordedTime = currentTime;
      globalThis.curBeat += passedBeats;
    }

    if (this.beatManagerSABInner) {
      this.beatManagerSAB[0] = globalThis.curBeat;
      this.beatManagerSAB[1] = globalTempoBPM;
    }
  }

  process(_inputs, _outputs, params) {
    this.updateGlobalBeats(params.global_tempo_bpm[0]);

    if (this.wasmInstance) {
      this.wasmInstance.exports.run(currentTime, globalThis.curBeat);
    }

    return true;
  }
}

registerProcessor('event-scheduler-audio-worklet-node-processor', EventSchedulerWorkletProcessor);
