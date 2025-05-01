import * as Comlink from 'comlink';

import type { EqualizerBand, EqualizerState } from 'src/equalizer/equalizer';
import d3 from './d3';
import { EQ_X_DOMAIN, EQ_GAIN_DOMAIN } from 'src/equalizer/conf';

const FRAME_SIZE = 128;

interface EqualizerBandWithAutomationBufIxs extends EqualizerBand {
  freqAutomationBufIx: number | null;
  qAutomationBufIx: number | null;
  gainAutomationBufIx: number | null;
}

export class EqualizerWorker {
  private wasmInstance!: WebAssembly.Instance;
  private textDecoder = new TextDecoder('utf-8');
  private ctxPtr = 0;
  private wasmMemoryBuffer: Float32Array = new Float32Array(0);
  private automationValsSAB: Float32Array | null = null;

  private getWasmMemoryBuffer() {
    if (
      this.wasmMemoryBuffer.buffer !==
      (this.wasmInstance.exports.memory as WebAssembly.Memory).buffer
    ) {
      this.wasmMemoryBuffer = new Float32Array(
        (this.wasmInstance.exports.memory as WebAssembly.Memory).buffer
      );
    }
    return this.wasmMemoryBuffer;
  }

  private handleWasmPanic = async (ptr: number, len: number) => {
    const memory = this.wasmInstance.exports.memory as WebAssembly.Memory;
    console.error(this.textDecoder.decode(memory.buffer.slice(ptr, ptr + len)));
  };

  public setWasmBytes = async (wasmBytes: ArrayBuffer) => {
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const importObj = { env: { log_err: this.handleWasmPanic } };
    this.wasmInstance = await WebAssembly.instantiate(wasmModule, importObj);
  };

  public setAutomationValsSAB = (automationValsSAB: Float32Array) => {
    this.automationValsSAB = automationValsSAB;
  };

  public setInitialState = ({
    bands,
  }: EqualizerState & { bands: EqualizerBandWithAutomationBufIxs[] }) => {
    this.ctxPtr = (this.wasmInstance.exports.equalizer_init as Function)();
    this.wasmMemoryBuffer = new Float32Array(
      (this.wasmInstance.exports.memory as WebAssembly.Memory).buffer
    );
    for (let bandIx = 0; bandIx < bands.length; bandIx++) {
      this.setBand(bandIx, bands[bandIx]);
    }
  };

  public setState = ({ bands }: { bands: EqualizerBandWithAutomationBufIxs[] }) => {
    (this.wasmInstance.exports.equalizer_set_band_count as Function)(this.ctxPtr, bands.length);
    for (let bandIx = 0; bandIx < bands.length; bandIx++) {
      const band = bands[bandIx];
      this.setBand(bandIx, band);
    }
  };

  public setBand = (
    bandIx: number,
    {
      filterType,
      frequency,
      q,
      gain,
      freqAutomationBufIx,
      qAutomationBufIx,
      gainAutomationBufIx,
    }: EqualizerBandWithAutomationBufIxs
  ) => {
    (this.wasmInstance.exports.equalizer_set_band as Function)(
      this.ctxPtr,
      bandIx,
      filterType,
      frequency,
      q,
      gain,
      !!this.automationValsSAB &&
        typeof freqAutomationBufIx === 'number' &&
        freqAutomationBufIx >= 0
        ? freqAutomationBufIx
        : 99999,
      !!this.automationValsSAB && typeof qAutomationBufIx === 'number' && qAutomationBufIx >= 0
        ? qAutomationBufIx
        : 99999,
      !!this.automationValsSAB &&
        typeof gainAutomationBufIx === 'number' &&
        gainAutomationBufIx >= 0
        ? gainAutomationBufIx
        : 99999
    );
  };

  public computeResponses = (
    gridSize: number,
    widthPx: number,
    heightPx: number,
    xDomain: [number, number] = EQ_X_DOMAIN,
    yDomain: [number, number] = EQ_GAIN_DOMAIN,
    animateAutomatedParams = true
  ) => {
    let memory = this.getWasmMemoryBuffer();

    if (this.automationValsSAB) {
      const automationBufsPtr = (
        this.wasmInstance.exports.equalizer_get_automation_bufs_ptr as Function
      )(this.ctxPtr);
      const automationBufs = memory.subarray(
        automationBufsPtr / Float32Array.BYTES_PER_ELEMENT,
        automationBufsPtr / Float32Array.BYTES_PER_ELEMENT +
          this.automationValsSAB.length * FRAME_SIZE
      );
      for (
        let automationSlotIx = 0;
        automationSlotIx < this.automationValsSAB.length;
        automationSlotIx += 1
      ) {
        automationBufs[automationSlotIx * FRAME_SIZE] = this.automationValsSAB[automationSlotIx];
      }
    }

    (this.wasmInstance.exports.equalizer_compute_responses as Function)(
      this.ctxPtr,
      gridSize,
      animateAutomatedParams
    );

    const freqsPtr = (this.wasmInstance.exports.equalizer_get_response_freqs_ptr as Function)(
      this.ctxPtr
    );
    const magsPtr = (this.wasmInstance.exports.equalizer_get_response_mags_ptr as Function)(
      this.ctxPtr
    );
    // const phasesPtr = (this.wasmInstance.exports.equalizer_get_response_phases_ptr as Function)(
    //   this.ctxPtr
    // );

    // have to re-acquire memory in case computing the responses caused it to grow
    memory = this.getWasmMemoryBuffer();

    const freqs = new Float32Array(memory.buffer, freqsPtr, gridSize);
    const mags = new Float32Array(memory.buffer, magsPtr, gridSize);
    // const phases = new Float32Array(memory.buffer, phasesPtr, gridSize);

    const xScale = d3.scaleLog().domain(xDomain).range([0, widthPx]);
    // TODO: Verify if this domain is good for response plot and unify with FFT viz
    const yScale = d3.scaleLinear([heightPx, 0]).domain(yDomain);
    const magResponsePath = d3
      .line<number>()
      .x((_d, i) => xScale(freqs[i]))
      .y(d => yScale(d))
      .curve(d3.curveMonotoneX)(mags)!;

    return { magResponsePath };
  };
}

Comlink.expose(new EqualizerWorker());
