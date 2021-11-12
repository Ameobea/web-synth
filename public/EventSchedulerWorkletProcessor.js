class ValueRecorderWorkletProcessor extends AudioWorkletProcessor {
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
      this.beatManagerSAB = new Float32Array(this.beatManagerSABInner);
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

          globalThis.curBeat = 0;
          this.lastRecordedTime = currentTime;
          this.isStarted = true;
          break;
        }
        case 'stop': {
          if (!this.wasmInstance) {
            console.error('Tried to stop event scheduler before Wasm initialized');
            break;
          }

          globalThis.curBeat = 0;
          this.wasmInstance.exports.stop();
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
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        default: {
          console.log(`Unhandled message type: ${event.data.type}`);
        }
      }
    };
  }

  async initWasm(arrayBuffer) {
    const compiledModule = await WebAssembly.compile(arrayBuffer);
    this.wasmInstance = new WebAssembly.Instance(compiledModule, {
      env: { run_callback: val => this.port.postMessage(val) },
    });

    // Schedule any events that we missed while the Wasm instance was initializing
    this.pendingEvents.forEach(event =>
      event.time === null
        ? this.scheduleBeatEvent(event.beat, event.cbId)
        : this.scheduleEvent(event.time, event.cbId)
    );
    this.pendingEvents = null;
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

    this.wasmInstance.exports.schedule_beats(beats, cbId);
  }

  updateGlobalBeats(globalTempoBPM) {
    globalThis.globalTempoBPM = globalTempoBPM;

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

registerProcessor('event-scheduler-audio-worklet-node-processor', ValueRecorderWorkletProcessor);
