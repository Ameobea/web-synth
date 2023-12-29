import type { LineSpectrogramWorkerMessage } from 'src/visualizations/LineSpectrogram/types';

class LineSpectrogramWorker {
  private wasmInstance: WebAssembly.Instance | null = null;
  private wasmMemoryBufferU8Clamped: Uint8ClampedArray = new Uint8ClampedArray(0);
  private notifySABI32: Int32Array | null = null;
  private frequencyDataSABU8: Uint8Array | null = null;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private running = true;
  private dpr = 1;
  /**
   * Used to uniquely identify the current animation loop to avoid having more than one
   * animation loop running at a time.
   */
  private runToken: number | null = null;

  public handleMessage(evt: MessageEvent<LineSpectrogramWorkerMessage>) {
    switch (evt.data.type) {
      case 'setWasmBytes':
        this.notifySABI32 = new Int32Array(evt.data.notifySAB);
        this.frequencyDataSABU8 = new Uint8Array(evt.data.frequencyDataSAB);
        this.setWasmBytes(evt.data.wasmBytes);
        break;
      case 'setCanvas':
        this.canvas = evt.data.canvas;
        this.dpr = evt.data.dpr;
        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) {
          throw new Error('Could not get 2d context from canvas');
        }
        break;
      case 'start':
        this.start();
        break;
      case 'stop':
        this.stop();
        break;
      case 'resizeCanvas':
        this.resizeView(evt.data.width, evt.data.height);
        break;
      default:
        console.error('Unknown message type in LineSpectrogramWorker', evt);
    }

    this.maybeSetViewToWasm();
    this.maybeStartAnimationLoop();
  }

  private getWasmMemoryBufferU8Clamped(): Uint8ClampedArray {
    if (!this.wasmInstance) {
      throw new Error('Tried to get wasm memory buffer before wasm instance was initialized');
    }

    const memory = this.wasmInstance.exports.memory as WebAssembly.Memory;
    if (this.wasmMemoryBufferU8Clamped.buffer !== memory.buffer) {
      this.wasmMemoryBufferU8Clamped = new Uint8ClampedArray(memory.buffer);
    }
    return this.wasmMemoryBufferU8Clamped;
  }

  private async setWasmBytes(wasmBytes: ArrayBuffer) {
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const decodeStr = (ptr: number, len: number) =>
      new TextDecoder().decode(this.getWasmMemoryBufferU8Clamped().subarray(ptr, ptr + len));
    this.wasmInstance = await WebAssembly.instantiate(wasmModule, {
      env: {
        log_err: (ptr: number, len: number) => console.error(decodeStr(ptr, len)),
        log_info: (ptr: number, len: number) => console.log(decodeStr(ptr, len)),
      },
    });

    this.maybeSetViewToWasm();
    this.maybeStartAnimationLoop();
  }

  private resizeView(width: number, height: number) {
    if (!this.canvas || !this.ctx) {
      console.error('Tried to resize view before canvas was set');
      return;
    }

    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.maybeSetViewToWasm();
  }

  private maybeSetViewToWasm() {
    if (!this.canvas || !this.wasmInstance) {
      return;
    }

    const setViewToWasm = this.wasmInstance.exports.line_spectrogram_set_view as (
      width: number,
      height: number,
      dpr: number
    ) => void;
    setViewToWasm(this.canvas.width / this.dpr, this.canvas.height / this.dpr, this.dpr);
  }

  private async maybeStartAnimationLoop() {
    if (
      !this.running ||
      !this.wasmInstance ||
      !this.notifySABI32 ||
      !this.frequencyDataSABU8 ||
      !this.canvas ||
      !this.ctx
    ) {
      return;
    }

    const runToken = Math.random() + Math.random() * 10 + Math.random() * 100;
    this.runToken = runToken;

    const hasWaitAsync = typeof Atomics.waitAsync === 'function';
    if (!hasWaitAsync) {
      console.warn(
        'Atomics.waitAsync not available, falling back to less efficient `Atomics.wait`-based implementation'
      );
    }

    const frequencyDataU8 = this.frequencyDataSABU8;
    const frequencyDataBufPtr = (
      this.wasmInstance.exports.line_spectrogram_get_frequency_data_ptr as () => number
    )();
    const process = this.wasmInstance.exports.line_spectrogram_process as () => void;
    const getImageDataPtr = this.wasmInstance.exports
      .line_spectrogram_get_image_data_ptr as () => number;

    let lastRenderedFrameIx = -1;

    while (true) {
      if (this.runToken !== runToken) {
        // A new animation loop has started, so stop this one.
        return;
      }

      let res: 'not-equal' | 'timed-out' | 'ok';
      if (hasWaitAsync) {
        res = await Atomics.waitAsync(this.notifySABI32, 0, lastRenderedFrameIx).value;
      } else {
        res = Atomics.wait(this.notifySABI32, 0, lastRenderedFrameIx, 5);
        // yield to allow microtasks to run
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (res === 'timed-out') {
        continue;
      }
      lastRenderedFrameIx = Atomics.load(this.notifySABI32, 0);

      // We have fresh frequency data to process
      let memoryU8 = this.getWasmMemoryBufferU8Clamped();
      memoryU8.set(frequencyDataU8, frequencyDataBufPtr);
      process();

      memoryU8 = this.getWasmMemoryBufferU8Clamped();
      const imageDataPtr = getImageDataPtr();
      const imageDataU8 = memoryU8.subarray(
        imageDataPtr,
        imageDataPtr + 4 * this.canvas.width * this.canvas.height
      );
      const imageData = new ImageData(imageDataU8, this.canvas.width, this.canvas.height);
      this.ctx.putImageData(imageData, 0, 0);
    }
  }

  private start() {
    this.running = true;
    this.maybeStartAnimationLoop();
  }

  private stop() {
    this.running = false;
    this.runToken = null;
  }
}

const lineSpectrogramWorker = new LineSpectrogramWorker();
self.addEventListener('message', event => lineSpectrogramWorker.handleMessage(event));
