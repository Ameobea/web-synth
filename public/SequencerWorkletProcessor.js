class ValueRecorderWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor() {
    super();

    this.config = null;
    this.startBeat = null;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'configure': {
          this.config = evt.data.config;
          break;
        }
        case 'start': {
          this.startBeat = globalThis.curBeat;
          this.lastBeats = this.config.voices.map(() => -1);
          break;
        }
        case 'stop': {
          this.startBeat = null;
          break;
        }
        default: {
          console.warn('Unhandled event type received over port: ' + evt.data.type);
        }
      }
    };
  }

  triggerVoice(i) {
    this.port.postMessage({ type: 'triggerVoice', i });
  }

  process(_inputs, _outputs, _params) {
    if (this.startBeat === null || !this.config) {
      return true;
    }

    const beatsSinceStart = globalThis.curBeat - this.startBeat;
    this.config.voices.forEach((voice, i) => {
      const curQuantizedBeat = Math.trunc(beatsSinceStart / voice.beatRatio);
      if (curQuantizedBeat !== this.lastBeats[i]) {
        this.lastBeats[i] = curQuantizedBeat;

        const markIx = curQuantizedBeat % this.config.beatCount;
        if (voice.marks[markIx]) {
          this.triggerVoice(i);
        }
      }
    });

    return true;
  }
}

registerProcessor('sequencer-audio-worklet-node-processor', ValueRecorderWorkletProcessor);
