import * as R from 'ramda';

import { AsyncOnce } from 'src/util';

const BYTES_PER_PX = 4; // RGBA

const WaveformRendererInstance = new AsyncOnce(() =>
  import('src/waveform_renderer').then(async instance => ({
    instance,
    memory: (await import('src/waveform_renderer_bg.wasm' as any)).memory,
  }))
);

export class WaveformRenderer {
  private wasm: {
    instance: typeof import('src/waveform_renderer');
    memory: typeof import('src/waveform_renderer_bg').memory;
    ctxPtr: number;
  } | null = null;
  private bounds: { startMs: number; endMs: number } = { startMs: 0, endMs: 0 };
  private widthPx = 1400;
  private heightPx = 240;
  private sampleRate = 44100;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private selection: { startMarkPosMs: number | null; endMarkPosMs: number | null } = {
    startMarkPosMs: null,
    endMarkPosMs: null,
  };

  public getWidthPx() {
    return this.widthPx;
  }
  public getHeightPx() {
    return this.heightPx;
  }
  public isInitialized() {
    return !!this.wasm;
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
  public setSelection({
    startMarkPosMs,
    endMarkPosMs,
  }: {
    startMarkPosMs: number | null;
    endMarkPosMs: number | null;
  }) {
    if (R.isNil(startMarkPosMs) && !R.isNil(endMarkPosMs)) {
      throw new Error('Setting nil startMarkPosMs with non-nil endMarkPosMs');
    }
    this.selection = { startMarkPosMs, endMarkPosMs };
    this.updateSelectionCbs();
  }

  constructor(sample?: AudioBuffer | null) {
    this.init(sample);
  }

  public reinitializeCtx(sample?: AudioBuffer | null) {
    if (!this.wasm) {
      throw new Error('Cannot re-initialize ctx before initializing wasm');
    }

    if (this.wasm.ctxPtr) {
      this.wasm.instance.free_waveform_renderer_ctx(this.wasm.ctxPtr);
    }
    this.wasm.ctxPtr = this.wasm.instance.create_waveform_renderer_ctx(
      sample?.length ?? 0,
      sample?.sampleRate ?? 44100,
      this.widthPx,
      this.heightPx
    );

    if (sample) {
      const waveformBufPtr = this.wasm.instance.get_waveform_buf_ptr(this.wasm.ctxPtr);
      const sampleData = new Float32Array(sample.length);
      sample.copyFromChannel(sampleData, 0);
      new Float32Array(this.wasm.memory.buffer).set(sampleData, waveformBufPtr / 4);
    }
  }

  private async init(sample?: AudioBuffer | null) {
    try {
      this.wasm = { ...(await WaveformRendererInstance.get()), ctxPtr: 0 };
      this.sampleRate = sample?.sampleRate ?? 44100;
      this.reinitializeCtx(sample);
      this.updateBoundsCbs();
      this.render();
    } catch (err) {
      console.error('Error initializing waveform renderer instance: ', err);
    }
  }

  public render() {
    if (
      this.bounds.endMs === 0 ||
      this.bounds.endMs - this.bounds.startMs <= 0 ||
      !this.wasm ||
      !this.canvasCtx
    ) {
      return;
    }

    const imageDataPtr = this.wasm.instance.render_waveform(
      this.wasm.ctxPtr,
      this.bounds.startMs,
      this.bounds.endMs
    );
    const imageDataBuf = new Uint8ClampedArray(
      this.wasm.memory.buffer.slice(
        imageDataPtr,
        imageDataPtr + this.widthPx * this.heightPx * BYTES_PER_PX
      )
    );
    const imageData = new ImageData(imageDataBuf, this.widthPx, this.heightPx);
    this.canvasCtx.putImageData(imageData, 0, 0);
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
    this.render();
  }

  private updateBoundsCbs() {
    this.boundsChangedCbs.forEach(cb => cb({ ...this.bounds }));
  }
  private updateSelectionCbs() {
    this.selectionChangedCbs.forEach(cb => cb({ ...this.selection }));
  }

  public setSample(sample: AudioBuffer) {
    this.sampleRate = sample?.sampleRate ?? 44100;
    this.reinitializeCtx(sample);
    if (this.bounds.endMs === 0) {
      this.setBounds(0, this.getSampleLengthMs());
    }
    this.updateBoundsCbs();
    this.render();
  }

  public appendSamples(samplesToAdd: Float32Array) {
    if (!this.wasm) {
      console.warn('Tried to append samples before wasm initialized');
      return;
    }

    this.wasm.instance.append_samples_to_waveform(this.wasm.ctxPtr, samplesToAdd);
    this.updateBoundsCbs();
    this.render();
  }

  public getSampleCount() {
    if (!this.wasm) {
      return 0;
    }

    return this.wasm.instance.get_sample_count(this.wasm.ctxPtr);
  }

  public getSampleLengthMs() {
    return (this.getSampleCount() / this.sampleRate) * 1000;
  }

  private boundsChangedCbs: ((bounds: { startMs: number; endMs: number }) => void)[] = [];
  private selectionChangedCbs: ((selection: {
    startMarkPosMs: number | null;
    endMarkPosMs: number | null;
  }) => void)[] = [];
  public addEventListener(
    type: 'boundsChange' | 'selectionChange',
    cb:
      | ((bounds: { startMs: number; endMs: number }) => void)
      | ((selection: { startMarkPosMs: number | null; endMarkPosMs: number | null }) => void)
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
    cb:
      | ((bounds: { startMs: number; endMs: number }) => void)
      | ((selection: { startMarkPosMs: number | null; endMarkPosMs: number | null }) => void)
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
