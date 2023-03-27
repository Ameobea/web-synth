type WorkerMessage =
  | { type: 'setSAB'; sab: SharedArrayBuffer }
  | { type: 'setWasmBytes'; wasmBytes: ArrayBuffer }
  | { type: 'setView'; view: OffscreenCanvas; dpr: number };

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

enum RendererStatusFlag {
  Running = 0,
  Paused = 1,
  Shutdown = 2,
}

const FRAME_SIZE = 128;

class OscilloscopeRendererWorker {
  private sabF32: Float32Array | null = null;
  private sabI32: Int32Array | null = null;
  private samplesCircularBuffer: Float32Array = new Float32Array(0);
  private wasmInstance: WebAssembly.Instance | null = null;
  private wasmMemoryBuffer: Float32Array = new Float32Array(0);
  private running = false;
  private lastProcessedBufferHeadIx = 0;
  private view: OffscreenCanvas | null = null;
  private dpr = 1;

  constructor() {
    this.startRenderLoop();
  }

  private renderFrame = () => {
    this.checkEvents();

    if (!this.view || !this.running) {
      return;
    }

    // TODO: Temp
    const ctx = this.view.getContext('2d')!;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, this.view.width, this.view.height);
    ctx.fillStyle = Math.random() > 0.5 ? 'red' : 'blue';
    ctx.fillRect(0, 0, 40, 40);
  };

  private startRenderLoop = () => {
    this.renderFrame();
    requestAnimationFrame(this.startRenderLoop);
  };

  public handleMessage(event: MessageEvent) {
    const message: WorkerMessage = event.data;

    if (!message || typeof message !== 'object' || !message.type) {
      console.warn(`Invalid message received in oscilloscope renderer worker: ${message}`);
      return;
    }

    switch (message.type) {
      case 'setSAB':
        this.setSAB(message.sab);
        break;
      case 'setWasmBytes':
        this.setWasmBytes(message.wasmBytes);
        break;
      case 'setView':
        this.view = message.view;
        this.dpr = message.dpr;
        break;
      default:
        console.warn(`Unknown message type: ${(message as any).type}`);
    }
  }

  private setSAB(sab: SharedArrayBuffer) {
    if (this.sabF32) {
      throw new Error('SAB already set');
    }

    this.sabF32 = new Float32Array(sab);
    this.samplesCircularBuffer = this.sabF32.subarray(8);
    if (this.samplesCircularBuffer.length % FRAME_SIZE !== 0) {
      throw new Error(
        `Invalid SAB size: ${this.samplesCircularBuffer.length} bytes.  Must be a multiple of ${FRAME_SIZE} (frame size) bytes.`
      );
    }
    this.sabI32 = new Int32Array(sab);
    this.checkAndStart();
  }

  private async setWasmBytes(wasmBytes: ArrayBuffer) {
    const wasmModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(wasmModule);
    this.checkAndStart();
  }

  private checkAndStart() {
    if (this.sabF32 && this.wasmInstance && !this.running) {
      this.running = true;
      this.run();
    }
  }

  /**
   * Checks for pause and shutdown events in the SAB and handles them accordingly.
   */
  private checkEvents() {
    if (!this.sabI32) {
      return;
    }

    const sabShutdownFlag = Atomics.load(this.sabI32, 0);
    switch (sabShutdownFlag) {
      case RendererStatusFlag.Paused:
        this.running = false;
        break;
      case RendererStatusFlag.Shutdown:
        this.shutdown();
        break;
      case RendererStatusFlag.Running:
        this.running = true;
        break;
      default:
        console.error(`Unknown shutdown flag value: ${sabShutdownFlag}`);
    }
  }

  getWasmMemoryBuffer() {
    if (!this.wasmInstance) {
      throw new Error('Tried to get wasm memory buffer before wasm instance was initialized');
    }

    const memory = this.wasmInstance.exports.memory as WebAssembly.Memory;
    if (this.wasmMemoryBuffer.buffer !== memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  private consumeBuffer() {
    while (true) {
      const curBpm = this.sabF32![4];
      const curBeat = this.sabF32![5];
      const curTime = this.sabF32![6];
      const bufferHeadIx = this.sabI32![7];

      if (bufferHeadIx !== this.lastProcessedBufferHeadIx) {
        if (!this.wasmInstance) {
          return;
        }

        if (bufferHeadIx % FRAME_SIZE !== 0) {
          throw new Error(`Buffer head index is not a multiple of frame size: ${bufferHeadIx}`);
        }

        const frameDataPtr: number = (
          this.wasmInstance.exports.oscilloscope_renderer_get_frame_data_ptr as any
        )();

        const process = this.wasmInstance.exports.oscilloscope_renderer_process as (
          curBpm: number,
          curBeat: number,
          curTime: number
        ) => void;
        const commitSamples = this.wasmInstance.exports
          .oscilloscope_renderer_commit_samples as () => void;

        // Copy over and process one frame of samples at a time from the SAB circular buffer to the wasm memory
        // until we've caught up to the current buffer head index
        while (this.lastProcessedBufferHeadIx !== bufferHeadIx) {
          const memory = this.getWasmMemoryBuffer();
          const frameData = memory.subarray(frameDataPtr / 4, frameDataPtr / 4 + FRAME_SIZE);

          // Buffer head index has not wrapped around
          frameData.set(
            this.samplesCircularBuffer.subarray(
              this.lastProcessedBufferHeadIx,
              this.lastProcessedBufferHeadIx + FRAME_SIZE
            )
          );
          this.lastProcessedBufferHeadIx += FRAME_SIZE;

          console.log(`Processing frame before head index: ${this.lastProcessedBufferHeadIx}`);
          commitSamples();

          if (this.lastProcessedBufferHeadIx >= this.samplesCircularBuffer.length) {
            // Buffer head index has wrapped around
            this.lastProcessedBufferHeadIx = 0;
          }
        }

        process(curBpm, curBeat, curTime);
      } else {
        break;
      }
    }
  }

  private async run() {
    while (this.running) {
      // Wait for the realtime audio rendering thread to render a frame
      const rtAudioWaitRes = Atomics.waitAsync(
        this.sabI32!,
        2,
        this.lastProcessedBufferHeadIx,
        500
      );

      await rtAudioWaitRes.value;

      // Consume any new samples from the audio rendering thread and update viz
      this.consumeBuffer();
    }
  }

  private shutdown() {
    this.running = false;
    self.close();
  }
}

const oscilloscopeRendererWorker = new OscilloscopeRendererWorker();
self.addEventListener('message', event => oscilloscopeRendererWorker.handleMessage(event));
