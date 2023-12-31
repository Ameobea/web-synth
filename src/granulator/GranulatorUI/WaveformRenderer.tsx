import * as R from 'ramda';
import * as Comlink from 'comlink';

import type { WaveformRendererWorker } from 'src/granulator/GranulatorUI/WaveformRendererWorker.worker';

export interface WaveformSelection {
  startMarkPosMs: number | null;
  endMarkPosMs: number | null;
}

export interface WaveformBounds {
  startMs: number;
  endMs: number;
}

export class WaveformRenderer {
  private worker: Comlink.Remote<WaveformRendererWorker>;
  private sampleCount = 0;
  private bounds: WaveformBounds = { startMs: 0, endMs: 0 };
  private selection: WaveformSelection = {
    startMarkPosMs: null,
    endMarkPosMs: null,
  };
  private widthPx = 1400;
  private heightPx = 240;
  private isRendering = false;
  private needsRender = false;
  private sampleRate = 44100;
  private canvasCtx: CanvasRenderingContext2D | null = null;

  public getWidthPx() {
    return this.widthPx;
  }
  public getHeightPx() {
    return this.heightPx;
  }
  public getSampleRate() {
    return this.sampleRate;
  }
  public getBounds() {
    return { ...this.bounds };
  }
  public getSelection() {
    return { ...this.selection };
  }

  public setSelection({ startMarkPosMs, endMarkPosMs }: WaveformSelection) {
    if (R.isNil(startMarkPosMs) && !R.isNil(endMarkPosMs)) {
      throw new Error('Setting nil startMarkPosMs with non-nil endMarkPosMs');
    }

    if (
      this.selection.startMarkPosMs === startMarkPosMs &&
      this.selection.endMarkPosMs === endMarkPosMs
    ) {
      return;
    }

    this.selection = { startMarkPosMs, endMarkPosMs };
    this.updateSelectionCbs();
  }

  constructor(sample?: AudioBuffer | null) {
    this.worker = Comlink.wrap(
      new Worker(new URL('./WaveformRendererWorker.worker.ts', import.meta.url))
    );
    if (sample) {
      this.sampleCount = sample.length;
    }
    this.init(sample);
  }

  public reinitializeCtx(sample?: AudioBuffer | null) {
    this.bounds = { startMs: 0, endMs: this.getSampleLengthMs() };
    this.selection = { startMarkPosMs: null, endMarkPosMs: null };

    this.worker.reinitializeCtx(
      this.widthPx,
      this.heightPx,
      (() => {
        if (!sample) {
          return undefined;
        }

        const sampleData = new Float32Array(sample.length);
        sample.copyFromChannel(sampleData, 0);
        return { data: sampleData, sampleRate: sample.sampleRate };
      })()
    );
  }

  private async init(sample?: AudioBuffer | null) {
    try {
      this.sampleRate = sample?.sampleRate ?? 44100;
      this.reinitializeCtx(sample);
      this.updateBoundsCbs();
      this.render();
    } catch (err) {
      console.error('Error initializing waveform renderer instance: ', err);
    }
  }

  public async render() {
    if (
      this.bounds.endMs === 0 ||
      this.bounds.endMs - this.bounds.startMs <= 0 ||
      !this.canvasCtx
    ) {
      return;
    }

    if (this.isRendering) {
      this.needsRender = true;
      return;
    }

    this.isRendering = true;
    const imageDataBuf = await this.worker.render(this.bounds, this.widthPx, this.heightPx);
    this.isRendering = false;

    const imageData = new ImageData(imageDataBuf, this.widthPx, this.heightPx);
    this.canvasCtx.putImageData(imageData, 0, 0);

    if (this.needsRender) {
      this.needsRender = false;
      this.render();
    }
  }

  public setCanvasCtx(ctx: CanvasRenderingContext2D | null | undefined) {
    this.canvasCtx = ctx ?? null;
    this.render();
  }

  public setBounds(startMs: number, endMs: number) {
    if (endMs < startMs) {
      console.error('Invalid bounds provided to waveform renderer: ', { startMs, endMs });
    }
    this.bounds = { startMs, endMs };
    this.updateBoundsCbs();
    setTimeout(() => this.render());
  }

  private updateBoundsCbs() {
    this.boundsChangedCbs.forEach(cb => cb({ ...this.bounds }));
  }

  private updateSelectionCbs() {
    this.selectionChangedCbs.forEach(cb => cb({ ...this.selection }));
  }

  public setSample(sample: AudioBuffer) {
    this.sampleCount = sample.length;
    this.sampleRate = sample?.sampleRate ?? 44100;
    this.reinitializeCtx(sample);
    this.updateBoundsCbs();
    this.render();
  }

  public async appendSamples(samplesToAdd: Float32Array) {
    this.sampleCount += samplesToAdd.length;
    await this.worker.appendSamples(Comlink.transfer(samplesToAdd, [samplesToAdd.buffer]));
    this.updateBoundsCbs();
    this.render();
  }

  public getSampleCount() {
    return this.sampleCount;
  }

  public getSampleLengthMs() {
    return (this.sampleCount / this.sampleRate) * 1000;
  }

  private boundsChangedCbs: ((bounds: WaveformBounds) => void)[] = [];
  private selectionChangedCbs: ((selection: WaveformSelection) => void)[] = [];
  public addEventListener(
    type: 'boundsChange' | 'selectionChange',
    cb: ((bounds: WaveformBounds) => void) | ((selection: WaveformSelection) => void)
  ) {
    switch (type) {
      case 'boundsChange': {
        this.boundsChangedCbs.push(cb as any);
        break;
      }
      case 'selectionChange': {
        this.selectionChangedCbs.push(cb as any);
        break;
      }
      default: {
        console.error('Unhandled event type in waveformrenderer: ', type);
      }
    }
  }

  public removeEventListener(
    type: 'boundsChange' | 'selectionChange',
    cb: ((bounds: WaveformBounds) => void) | ((selection: WaveformSelection) => void)
  ) {
    switch (type) {
      case 'boundsChange': {
        this.boundsChangedCbs = this.boundsChangedCbs.filter(oCb => oCb !== cb);
        break;
      }
      case 'selectionChange': {
        this.selectionChangedCbs = this.selectionChangedCbs.filter(oCb => oCb !== cb);
        break;
      }
      default: {
        console.error('Unhandled event type in waveformrenderer: ', type);
      }
    }
  }
}
