import { get, type Writable, writable } from 'svelte/store';

import { logError } from 'src/sentry';
import { AsyncOnce } from 'src/util';
import { LineSpectrogramFFTSize } from 'src/visualizations/LineSpectrogram/conf';
import type {
  LineSpectrogramUIState,
  LineSpectrogramWorkerMessage,
} from 'src/visualizations/LineSpectrogram/types';

const LineSpectrogramWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'spectrum_viz_full.wasm?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);

/**
 * Visualization of the immediate spectrum of audio input signal.  Uses `AnalyserNode` to perform STFFT and
 * `OffscreenCanvas` to render the spectrogram.  The spectrogram is rendered as a smooth line with the line's
 * Y position at each point representing the amplitude of the frequency at that point.
 */
export class LineSpectrogram {
  public store: Writable<LineSpectrogramUIState>;
  private analyserNode: AnalyserNode;
  private renderWorker: Worker;
  private notifySAB: SharedArrayBuffer;
  private notifySABI32: Int32Array;
  private frequencyDataSAB: SharedArrayBuffer;
  private frequencyDataSABU8: Uint8Array;
  private frequencyDataBufTemp: Uint8Array;
  private running = false;
  private frameIx = 0;

  constructor(initialState: LineSpectrogramUIState, analyserNode: AnalyserNode) {
    this.store = writable(initialState);
    if (analyserNode.fftSize !== LineSpectrogramFFTSize) {
      throw new Error(
        `LineSpectrogram requires analyserNode.fftSize to be ${LineSpectrogramFFTSize}, but it was ${analyserNode.fftSize}`
      );
    }
    this.analyserNode = analyserNode;
    this.renderWorker = new Worker(new URL('./LineSpectrogram.worker', import.meta.url));

    this.notifySAB = new SharedArrayBuffer(4);
    this.notifySABI32 = new Int32Array(this.notifySAB);
    this.frequencyDataSAB = new SharedArrayBuffer(LineSpectrogramFFTSize / 2);
    this.frequencyDataSABU8 = new Uint8Array(this.frequencyDataSAB);
    this.frequencyDataBufTemp = new Uint8Array(LineSpectrogramFFTSize / 2);

    this.init().catch(err => {
      logError('Error initializing oscilloscope', err);
    });
  }

  private async init() {
    const wasmBytes = await LineSpectrogramWasmBytes.get();
    const msg: LineSpectrogramWorkerMessage = {
      type: 'setWasmBytes',
      wasmBytes,
      frequencyDataSAB: this.frequencyDataSAB,
      notifySAB: this.notifySAB,
    };
    this.renderWorker.postMessage(msg);
  }

  // We need to drive animation from the main thread because getting the frequency data from the
  // analyser node can only be done on the main thread.
  private animate = () => {
    if (!this.running) {
      return;
    }

    const frameIx = (this.frameIx + 1) % 100_000;
    this.frameIx = frameIx;

    // Browser is hilarious and doesn't let us write to shared buffer directly, so we have to waste a copy.
    this.analyserNode.getByteFrequencyData(this.frequencyDataBufTemp);
    this.frequencyDataSABU8.set(this.frequencyDataBufTemp);
    Atomics.store(this.notifySABI32, 0, frameIx);
    Atomics.notify(this.notifySABI32, 0);

    requestAnimationFrame(() => this.animate());
  };

  public setCanvas(canvas: OffscreenCanvas, dpr: number) {
    if (dpr !== Math.floor(dpr)) {
      throw new Error('dpr must be an integer');
    }

    const msg: LineSpectrogramWorkerMessage = { type: 'setCanvas', canvas, dpr };
    this.renderWorker.postMessage(msg, [canvas]);
  }

  public resizeView(width: number, height: number) {
    const msg: LineSpectrogramWorkerMessage = { type: 'resizeCanvas', width, height };
    this.renderWorker.postMessage(msg);
  }

  public start() {
    this.running = true;
    this.animate();
  }

  public stop() {
    this.running = false;
  }

  public destroy() {
    this.renderWorker.terminate();
  }

  public serialize(): LineSpectrogramUIState {
    return get(this.store);
  }
}
