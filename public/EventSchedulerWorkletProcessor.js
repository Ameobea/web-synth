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
    globalThis.curBeat = 0;

    super();
    this.pendingEvents = [];
    this.lastRecordedTime = 0;

    this.port.onmessage = event => {
      switch (event.data.type) {
        case 'init': {
          this.initWasm(event.data.wasmArrayBuffer);
          break;
        }
        case 'schedule': {
          this.scheduleEvent(event.data.time, event.data.cbId);
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
    this.pendingEvents.forEach(event => this.scheduleEvent(event.time, event.cbId));
  }

  scheduleEvent(time, cbId) {
    if (!this.wasmInstance) {
      this.pendingEvents.push({ time, cbId });
      return;
    }

    this.wasmInstance.exports.schedule(time, cbId);
  }

  updateGlobalBeats(globalTempoBPM) {
    const passedTime = currentTime - this.lastRecordedTime;
    const passedBeats = (globalTempoBPM / 60) * passedTime;
    this.lastRecordedTime = currentTime;
    globalThis.curBeat += passedBeats;
  }

  process(_inputs, _outputs, params) {
    this.updateGlobalBeats(params.global_tempo_bpm[0]);
    if (this.wasmInstance) {
      this.wasmInstance.exports.run(currentTime);
    }

    return true;
  }
}

registerProcessor('event-scheduler-audio-worklet-node-processor', ValueRecorderWorkletProcessor);
