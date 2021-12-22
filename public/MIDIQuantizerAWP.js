class MIDIQuantizerAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'control',
        defaultValue: 0,
        minValue: -1,
        maxValue: 1,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();

    this.pendingMessages = [];

    this.port.onmessage = evt => {
      if (!this.wasmInstance && evt.data.type !== 'setWasmBytes') {
        this.pendingMessages.push(evt.data);
        return;
      }

      this.handleMessage(evt.data);
    };
  }

  handleMessage = async data => {
    switch (data.type) {
      case 'setWasmBytes': {
        await this.initWasm(data.wasmBytes);
        break;
      }
      case 'setState': {
        this.setState(data.state);
        break;
      }

      default: {
        console.warn('Unhandled message type in midi quantizer AWP: ', data.type);
      }
    }
  };

  setState = ({ octaveRange, activeNotes, isRunning }) => {
    this.wasmInstance.exports.set_octave_range(octaveRange[0], octaveRange[1]);
    activeNotes.forEach((isActive, noteIx) =>
      this.wasmInstance.exports.set_note_active(noteIx, isActive)
    );
    this.wasmInstance.exports.set_is_running(isRunning);
    this.wasmInstance.exports.finalize_state_update();
  };

  playNote = note => this.port.postMessage({ type: 'playNote', note });

  releaseNote = note => this.port.postMessage({ type: 'releaseNote', note });

  async initWasm(wasmBytes) {
    const importObject = {
      env: { play_note: this.playNote, release_note: this.releaseNote },
    };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    this.pendingMessages.forEach(data => this.handleMessage(data));
    this.pendingMessages = [];
  }

  process(_inputs, _outputs, params) {
    if (!this.wasmInstance) {
      return true;
    }

    const controlSample = params.control[0];
    this.wasmInstance.exports.process(controlSample);

    return true;
  }
}

registerProcessor('midi-quantizer', MIDIQuantizerAWP);
