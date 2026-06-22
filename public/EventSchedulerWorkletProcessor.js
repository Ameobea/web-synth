// Clock owner / control plane for the order-independent transport (see
// `docs/midi-scheduling-redesign.md`).  It owns the active tempo map, latches the playback start
// frame, publishes the current beat/bpm to the main thread via `beatManagerSAB`, and fires
// `cbId`-only callback events (UI visuals, loop top-up) through the Rust heap.  MIDI no longer
// routes through here; it lives in `globalThis.transport` and is polled directly by consumers.

const { TempoMap, Transport } = globalThis.WebSynthTransport;

const FRAME_SIZE = 128;
const DEFAULT_BPM = 120;

globalThis.transport = new Transport(TempoMap.constant(sampleRate, DEFAULT_BPM), FRAME_SIZE);

class EventSchedulerWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    globalThis.curBeat = 0;
    globalThis.globalTempoBPM = DEFAULT_BPM;
    globalThis.globalBeatCounterStarted = false;
    // Incremented each time playback is re/started
    globalThis.playbackSeq = 0;

    if (typeof SharedArrayBuffer !== 'undefined') {
      this.beatManagerSABInner = new SharedArrayBuffer(1024);
      this.beatManagerSAB = new Float64Array(this.beatManagerSABInner);
      this.beatManagerSAB[1] = DEFAULT_BPM;
    }
    this.port.postMessage({ type: 'beatManagerSAB', beatManagerSAB: this.beatManagerSAB });

    this.pendingEvents = [];
    this.isStarted = false;
    this.startFrame = 0;
    this.startBeat = 0;
    this.baseBpm = DEFAULT_BPM;
    this.tempoChanges = [{ beat: 0, bpm: DEFAULT_BPM }];

    this.port.onmessage = event => {
      switch (event.data.type) {
        case 'init': {
          this.initWasm(event.data.wasmArrayBuffer);
          break;
        }
        case 'setTempoChanges': {
          this.tempoChanges =
            event.data.changes?.length > 0 ? event.data.changes : [{ beat: 0, bpm: DEFAULT_BPM }];
          this.baseBpm = this.tempoChanges[0].bpm;
          if (this.isStarted) {
            const anchorBeat = globalThis.transport.beatAt(currentFrame);
            globalThis.transport.tempoMap = TempoMap.fromTempoChanges(
              sampleRate,
              this.tempoChanges,
              anchorBeat,
              currentFrame
            );
          } else {
            globalThis.transport.tempoMap = TempoMap.constant(sampleRate, this.baseBpm);
          }
          break;
        }
        case 'start': {
          if (!this.wasmInstance) {
            console.error('Tried to start event scheduler before Wasm initialized');
            break;
          }

          this.startBeat = event.data.startBeat;
          this.startFrame = currentFrame;
          globalThis.transport.reset();
          globalThis.transport.tempoMap = TempoMap.fromTempoChanges(
            sampleRate,
            this.tempoChanges,
            this.startBeat,
            this.startFrame
          );
          globalThis.curBeat = this.startBeat;
          globalThis.globalBeatCounterStarted = true;
          globalThis.playbackSeq += 1;
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
          globalThis.transport.reset();
          globalThis.transport.tempoMap = TempoMap.constant(sampleRate, this.baseBpm);
          this.isStarted = false;
          break;
        }
        case 'schedule': {
          this.scheduleEvent(event.data.time, event.data.cbId);
          break;
        }
        case 'scheduleBeats': {
          this.scheduleEventBeats(event.data.beats, event.data.cbId);
          break;
        }
        case 'scheduleBeatsRelative': {
          this.scheduleEventBeats(globalThis.curBeat + event.data.beatsFromNow, event.data.cbId);
          break;
        }
        case 'scheduleMIDI': {
          const d = event.data;
          globalThis.transport.scheduleMIDI(d.targetID, d.beat, d.eventType, d.param0, d.param1, d.id);
          break;
        }
        case 'insertLiveMIDI': {
          const d = event.data;
          globalThis.transport.insertLiveMIDI(d.targetID, d.eventType, d.param0, d.param1);
          break;
        }
        case 'cancelMIDI': {
          globalThis.transport.cancelMIDI(event.data.ids);
          break;
        }
        case 'cancelAndRescheduleMany': {
          if (!this.wasmInstance) {
            console.error('Tried to cancel and reschedule events before Wasm initialized');
            break;
          }

          const { cancelledCbIDs, newEvents } = event.data;
          globalThis.transport.cancelMIDI(cancelledCbIDs);

          const idsBufPtr = this.wasmInstance.exports.alloc_ids_buffer(cancelledCbIDs.length);
          const idsBuf = new Int32Array(
            this.wasmInstance.exports.memory.buffer,
            idsBufPtr,
            cancelledCbIDs.length
          );
          for (let i = 0; i < cancelledCbIDs.length; i++) {
            idsBuf[i] = cancelledCbIDs[i];
          }
          this.wasmInstance.exports.cancel_events_by_ids();

          this.scheduleAllEventsAfterCurrentTimeOrBeat(newEvents);
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
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
        // MIDI no longer routes through the Rust heap, but the import must still be satisfied.
        run_midi_callback: () => {
          console.error('run_midi_callback invoked but MIDI no longer routes through the scheduler');
        },
      },
    });

    // Schedule any events that we missed while the Wasm instance was initializing
    this.pendingEvents.forEach(event =>
      event.time === null
        ? this.scheduleEventBeats(event.beats, event.cbId)
        : this.scheduleEvent(event.time, event.cbId)
    );
    this.pendingEvents = null;
  }

  /**
   * @param {Array<{ at: {type: 'time'; time: number} | {type: 'beats'; beat: number}; cbId: number; mailboxID: string|null; midiEventType: number | null | undefined; param0: number; param1: number }>} events
   */
  scheduleAllEventsAfterCurrentTimeOrBeat(events) {
    const curBeat = globalThis.curBeat;

    let scheduledCount = 0;
    for (const event of events) {
      if (event.at.type === 'beats' && event.at.beat >= curBeat) {
        if (event.mailboxID) {
          globalThis.transport.scheduleMIDI(
            event.mailboxID,
            event.at.beat,
            event.midiEventType,
            event.param0,
            event.param1,
            event.cbId
          );
        } else {
          this.scheduleEventBeats(event.at.beat, event.cbId);
        }
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

  scheduleEventBeats(beats, cbId) {
    if (!this.wasmInstance) {
      this.pendingEvents.push({ time: null, beats, cbId });
      return;
    }

    this.wasmInstance.exports.schedule_beats(beats, cbId, -1, 0, 0, 0);
  }

  process(_inputs, _outputs, _params) {
    if (this.isStarted) {
      const curBeat = globalThis.transport.beatAt(currentFrame);
      const bpm = globalThis.transport.bpmAt(currentFrame);
      globalThis.curBeat = curBeat;
      globalThis.globalTempoBPM = bpm;
      if (this.beatManagerSAB) {
        this.beatManagerSAB[0] = curBeat;
        this.beatManagerSAB[1] = bpm;
      }
    } else {
      globalThis.curBeat = this.beatManagerSAB ? this.beatManagerSAB[0] : globalThis.curBeat;
      globalThis.globalTempoBPM = this.baseBpm;
      if (this.beatManagerSAB) {
        this.beatManagerSAB[1] = this.baseBpm;
      }
    }

    if (this.wasmInstance) {
      this.wasmInstance.exports.run(currentTime, globalThis.curBeat);
    }

    return true;
  }
}

registerProcessor('event-scheduler-audio-worklet-node-processor', EventSchedulerWorkletProcessor);
