import type { FilterResponseVizWorkerMessage } from 'src/synthDesigner/filterResponseViz/types';

// cap the render rate at ~180fps while params are sweeping
const MIN_RENDER_INTERVAL_MS = 1000 / 180;

class FilterResponseVizWorker {
  private wasmInstance: WebAssembly.Instance | null = null;
  private wasmMemoryF32: Float32Array = new Float32Array(0);
  private ctxPtr = 0;
  /** SAB views written by the audio thread: `notifyI32[0]` = seq, `paramsF32[1..4]` = q, cutoff, gain. */
  private notifyI32: Int32Array | null = null;
  private paramsF32: Float32Array | null = null;
  private canvas: OffscreenCanvas | null = null;
  private ctx2d: OffscreenCanvasRenderingContext2D | null = null;
  private dpr = 1;
  private dbDomain: [number, number] = [-40, 20];
  private lineColor = '#e8e8e8';
  private filterType = 0;
  private active = true;
  private loopRunning = false;
  private lastRenderTime = 0;

  public handleMessage(evt: MessageEvent<FilterResponseVizWorkerMessage>) {
    switch (evt.data.type) {
      case 'setWasmBytes':
        this.notifyI32 = new Int32Array(evt.data.sab);
        this.paramsF32 = new Float32Array(evt.data.sab);
        this.setWasmBytes(evt.data.wasmBytes);
        break;
      case 'setCanvas':
        this.canvas = evt.data.canvas;
        this.dpr = evt.data.dpr;
        this.dbDomain = evt.data.dbDomain;
        this.lineColor = evt.data.lineColor;
        this.ctx2d = this.canvas.getContext('2d');
        this.render();
        break;
      case 'setFilterType':
        this.filterType = evt.data.filterType;
        this.render();
        break;
      case 'setActive':
        this.active = evt.data.active;
        if (this.active) {
          this.render();
        }
        break;
      default:
        console.error('Unknown message in FilterResponseVizWorker', evt.data);
    }

    this.maybeStartAnimationLoop();
  }

  private getWasmMemoryF32(): Float32Array {
    const memory = (this.wasmInstance!.exports.memory as WebAssembly.Memory).buffer;
    if (this.wasmMemoryF32.buffer !== memory) {
      this.wasmMemoryF32 = new Float32Array(memory);
    }
    return this.wasmMemoryF32;
  }

  private async setWasmBytes(wasmBytes: ArrayBuffer) {
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const decodeErr = (ptr: number, len: number) =>
      new TextDecoder().decode(new Uint8Array(this.getWasmMemoryF32().buffer, ptr, len));
    this.wasmInstance = await WebAssembly.instantiate(wasmModule, {
      env: { log_err: (ptr: number, len: number) => console.error(decodeErr(ptr, len)) },
    });
    this.ctxPtr = (this.wasmInstance.exports.filter_viz_init as () => number)();
    this.render();
    this.maybeStartAnimationLoop();
  }

  private render() {
    if (!this.wasmInstance || !this.ctxPtr || !this.canvas || !this.ctx2d || !this.paramsF32) {
      return;
    }

    const gridSize = this.canvas.width;
    if (gridSize === 0) {
      return;
    }
    const q = this.paramsF32[1];
    const cutoff = this.paramsF32[2];
    const gain = this.paramsF32[3];

    (
      this.wasmInstance.exports.filter_viz_compute as (
        ctx: number,
        filterType: number,
        q: number,
        cutoff: number,
        gain: number,
        gridSize: number
      ) => void
    )(this.ctxPtr, this.filterType, q, cutoff, gain, gridSize);
    const magsPtr = (this.wasmInstance.exports.filter_viz_get_mags_ptr as (ctx: number) => number)(
      this.ctxPtr
    );
    const memory = this.getWasmMemoryF32();
    const mags = memory.subarray(magsPtr / 4, magsPtr / 4 + gridSize);

    const w = this.canvas.width;
    const h = this.canvas.height;
    const [dbMin, dbMax] = this.dbDomain;
    const dbRange = dbMax - dbMin;

    const ctx = this.ctx2d;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1.5 * this.dpr;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.lineColor;
    ctx.beginPath();
    for (let i = 0; i < gridSize; i += 1) {
      const x = (i / (gridSize - 1)) * w;
      const y = h - ((mags[i] - dbMin) / dbRange) * h;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    this.lastRenderTime = performance.now();
  }

  private async maybeStartAnimationLoop() {
    if (this.loopRunning) {
      return;
    }
    if (!this.active || !this.wasmInstance || !this.notifyI32 || !this.canvas || !this.ctx2d) {
      return;
    }
    this.loopRunning = true;

    const hasWaitAsync = typeof Atomics.waitAsync === 'function';
    const notifyI32 = this.notifyI32;
    let lastSeq = Atomics.load(notifyI32, 0);

    try {
      while (this.active) {
        let res: 'not-equal' | 'timed-out' | 'ok';
        if (hasWaitAsync) {
          res = await Atomics.waitAsync(notifyI32, 0, lastSeq).value;
        } else {
          res = Atomics.wait(notifyI32, 0, lastSeq, 50) as 'not-equal' | 'timed-out' | 'ok';
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (res === 'timed-out') {
          continue;
        }

        const sinceLast = performance.now() - this.lastRenderTime;
        if (sinceLast < MIN_RENDER_INTERVAL_MS) {
          await new Promise(resolve => setTimeout(resolve, MIN_RENDER_INTERVAL_MS - sinceLast));
          if (!this.active) {
            break;
          }
        }

        lastSeq = Atomics.load(notifyI32, 0);
        this.render();
      }
    } finally {
      this.loopRunning = false;
    }
  }
}

const worker = new FilterResponseVizWorker();
self.addEventListener('message', evt => worker.handleMessage(evt));
