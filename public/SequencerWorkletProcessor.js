class SequencerWorkletProcessor extends AudioWorkletProcessor {
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
          this.startBeat = evt.data.startBeat ?? globalThis.curBeat;
          this.lastBeat = Math.trunc(evt.data.startBeat / this.config.beatRatio);
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

  triggerVoice(voiceIx, markIx) {
    this.port.postMessage({ type: 'triggerVoice', voiceIx, markIx });
  }

  updateActiveBeat(markIx) {
    this.port.postMessage({ type: 'updateCurActiveBeat', markIx });
  }

  process(_inputs, _outputs, _params) {
    if (this.startBeat === null || !this.config) {
      return true;
    }

    const beatsSinceStart = globalThis.curBeat;
    const curQuantizedBeat = Math.trunc(beatsSinceStart / this.config.beatRatio);

    if (curQuantizedBeat !== this.lastBeat) {
      this.lastBeat = curQuantizedBeat;
      const markIx = curQuantizedBeat % this.config.beatCount;
      this.updateActiveBeat(markIx);

      this.config.voices.forEach((voice, i) => {
        if (voice.marks[markIx]) {
          this.triggerVoice(i, markIx);
        }
      });
    }

    return true;
  }
}

registerProcessor('sequencer-audio-worklet-node-processor', SequencerWorkletProcessor);
