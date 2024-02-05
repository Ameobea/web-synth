import * as Comlink from 'comlink';
import type { WaveformBounds } from 'src/granulator/GranulatorUI/WaveformRenderer';

const BYTES_PER_PX = 4; // RGBA

export class WaveformRendererWorker {
  private inst: Promise<typeof import('../../waveform_renderer')>;
  private ctxPtr: number = 0;

  constructor() {
    this.inst = import('../../waveform_renderer');
  }

  private get memory() {
    return this.inst.then(inst => inst.get_memory() as WebAssembly.Memory);
  }

  public async reinitializeCtx(
    widthPx: number,
    heightPx: number,
    sample?: { data: Float32Array; sampleRate?: number }
  ) {
    const inst = await this.inst;
    if (this.ctxPtr) {
      inst.free_waveform_renderer_ctx(this.ctxPtr);
    }
    this.ctxPtr = inst.create_waveform_renderer_ctx(
      sample?.data.length ?? 0,
      sample?.sampleRate ?? 44100,
      widthPx,
      heightPx
    );

    if (sample) {
      const waveformBufPtr = inst.get_waveform_buf_ptr(this.ctxPtr);
      new Float32Array((await this.memory).buffer).set(sample.data, waveformBufPtr / 4);
    }
  }

  public async render(bounds: WaveformBounds, widthPx: number, heightPx: number) {
    if (bounds.endMs <= bounds.startMs) {
      console.error('Invalid bounds:', bounds);
      return new Uint8ClampedArray(widthPx * heightPx * BYTES_PER_PX);
    }

    const inst = await this.inst;
    const imageDataPtr = inst.render_waveform(this.ctxPtr, bounds.startMs, bounds.endMs);
    return new Uint8ClampedArray(
      (await this.memory).buffer.slice(
        imageDataPtr,
        imageDataPtr + widthPx * heightPx * BYTES_PER_PX
      )
    );
  }

  public async appendSamples(samplesToAdd: Float32Array) {
    (await this.inst).append_samples_to_waveform(this.ctxPtr, samplesToAdd);
  }

  public async getSampleCount() {
    return (await this.inst).get_sample_count(this.ctxPtr);
  }
}

Comlink.expose(new WaveformRendererWorker());
