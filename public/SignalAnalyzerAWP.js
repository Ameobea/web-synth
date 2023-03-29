const FRAME_SIZE = 128;
const BYTES_PER_F32 = 4;
// ~2 seconds of audio
const CIRCULAR_BUFFER_LEN_SAMPLES = 345 * 2 * FRAME_SIZE;
const SAB_SIZE = (8 + CIRCULAR_BUFFER_LEN_SAMPLES) * BYTES_PER_F32;

class SignalAnalyzerAWP extends AudioWorkletProcessor {
  constructor() {
    super();

    const sab = new SharedArrayBuffer(SAB_SIZE);
    this.sabF32 = new Float32Array(sab);
    this.sabI32 = new Int32Array(sab);
    this.samplesCircularBuffer = this.sabF32.subarray(8);
    if (this.samplesCircularBuffer.length % FRAME_SIZE !== 0) {
      throw new Error(
        `Circular buffer length (${this.samplesCircularBuffer.length}) is not divisible by frame size (${FRAME_SIZE})`
      );
    }

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'sendSAB':
          this.port.postMessage({ type: 'setSAB', sab });
          break;
        default:
          console.error('Unknown message type', evt.data.type);
      }
    };
  }

  process(inputs, _outputs, _params) {
    const input = inputs[0]?.[0];
    if (!input) {
      return true;
    }

    const sampleCount = input.length;
    // SAB Layout (32-bit increments):
    // 0: [int32] shutdown / pause flag.  0 = running, 1 = paused, 2 = shutdown
    // 1: [int32] reserved
    // 2: [int32] incremented by realtime audio rendering thread each time it renders a frame into the buffer
    // 3: [f32] current beat at the point the most recently processed frame was rendered
    // 4: [f32] current time in seconds of the audio context
    // 5: [f32] current bpm at the point the most recently processed frame was rendered
    // 7: [int32] circular buffer head index.  This is zero-indexed relative to the start of the buffer,
    //             so you read sabF32[7] to get the first sample in the buffer, sabF32[8] to get the second, etc.
    //             It is incremented by the realtime audio rendering thread each time it renders a frame
    // 8-: [float32][] circular buffer containing raw samples from the realtime audio rendering thread.  It
    //                 extends to the end of the SAB.

    let head = Atomics.load(this.sabI32, 7);
    const bufferLen = this.samplesCircularBuffer.length;
    for (let i = 0; i < sampleCount; i++) {
      this.samplesCircularBuffer[head] = input[i];
      head = (head + 1) % bufferLen;
    }
    Atomics.store(this.sabI32, 7, head);
    Atomics.notify(this.sabI32, 7);
    Atomics.add(this.sabI32, 2, 1);
    Atomics.notify(this.sabI32, 2);
    this.sabF32[3] = globalThis.curBeat;
    this.sabF32[4] = globalThis.currentTime;
    this.sabF32[5] = globalThis.globalTempoBPM;

    return true;
  }
}

registerProcessor('signal-analyzer-awp', SignalAnalyzerAWP);
