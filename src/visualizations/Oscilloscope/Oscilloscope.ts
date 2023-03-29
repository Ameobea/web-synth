import { logError } from 'src/sentry';
import { AsyncOnce } from 'src/util';

const OscilloscopeWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'oscilloscope.wasm?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : crypto.randomUUID())
    ).then(res => res.arrayBuffer()),
  true
);

export class Oscilloscope {
  private renderWorker: Worker;
  private sab: Int32Array = new Int32Array(8);

  constructor() {
    this.renderWorker = new Worker(new URL('./OscilloscopeRenderer.worker', import.meta.url));
    this.init().catch(err => {
      logError('Error initializing oscilloscope', err);
    });
  }

  private async init() {
    const wasmBytes = await OscilloscopeWasmBytes.get();
    this.renderWorker.postMessage({ type: 'setWasmBytes', wasmBytes }, [wasmBytes]);
  }

  public setSAB(sab: SharedArrayBuffer) {
    this.sab = new Int32Array(sab);
    this.renderWorker.postMessage({ type: 'setSAB', sab });
  }

  public setView(view: OffscreenCanvas, dpr: number) {
    // dpr must be an integer
    if (dpr !== Math.floor(dpr)) {
      throw new Error('dpr must be an integer for oscilloscope');
    }
    this.renderWorker.postMessage({ type: 'setView', view, dpr }, [view]);
  }

  public pause() {
    Atomics.store(this.sab, 0, 1);
  }

  public resume() {
    Atomics.store(this.sab, 0, 0);
  }

  public destroy() {
    this.renderWorker.terminate();
  }
}
