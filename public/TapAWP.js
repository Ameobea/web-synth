const FRAME_SIZE = 128;
const AUTO_FLUSH_FRAMES = 64;

class TapAWP extends AudioWorkletProcessor {
  constructor() {
    super({ numberOfInputs: 1, numberOfOutputs: 0 });
    this.chunks = [];
    this.stopped = false;
    this.port.onmessage = e => {
      const t = e.data && e.data.type;
      if (t === 'drain') {
        this.flush();
      } else if (t === 'stop') {
        this.flush();
        this.stopped = true;
      }
    };
  }

  flush() {
    const transferables = [];
    for (const frame of this.chunks) {
      for (const ch of frame) {
        transferables.push(ch.buffer);
      }
    }
    this.port.postMessage({ type: 'chunks', chunks: this.chunks }, transferables);
    this.chunks = [];
  }

  process(inputs) {
    if (this.stopped) {
      return false;
    }
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const frame = new Array(input.length);
    for (let c = 0; c < input.length; c++) {
      const src = input[c];
      const copy = new Float32Array(FRAME_SIZE);
      if (src.length === FRAME_SIZE) {
        copy.set(src);
      }
      frame[c] = copy;
    }
    this.chunks.push(frame);
    if (this.chunks.length >= AUTO_FLUSH_FRAMES) {
      this.flush();
    }
    return true;
  }
}

registerProcessor('tap-awp', TapAWP);
