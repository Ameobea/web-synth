import type FMSynth from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import {
  FILTER_VIZ_DB_DOMAIN,
  FILTER_VIZ_LINE_COLOR,
} from 'src/synthDesigner/filterResponseViz/conf';
import type { FilterResponseVizWorkerMessage } from 'src/synthDesigner/filterResponseViz/types';
import { AsyncOnce } from 'src/util';

const FilterVizWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'filter_viz.wasm?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);

export const prefetchFilterVizWasm = () => void FilterVizWasmBytes.get();

/**
 * Owns the off-thread renderer for the synth designer filter's frequency response.  The audio thread
 * writes live filter params into a `SharedArrayBuffer`; the worker waits on it via atomics and renders
 * the response curve onto a transferred `OffscreenCanvas` with zero per-frame main-thread work.
 */
export class FilterResponseViz {
  private worker: Worker;
  private fmSynth: FMSynth;
  private ready = false;
  private destroyed = false;
  private pendingCanvas: { canvas: OffscreenCanvas; dpr: number } | null = null;
  private filterType: number;
  private active: boolean;

  constructor(fmSynth: FMSynth, initialFilterType: number, active: boolean) {
    this.fmSynth = fmSynth;
    this.filterType = initialFilterType;
    this.active = active;
    this.worker = new Worker(new URL('./FilterResponseVizWorker.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.init();
  }

  private post(msg: FilterResponseVizWorkerMessage, transfer?: Transferable[]) {
    this.worker.postMessage(msg, transfer ?? []);
  }

  private async init() {
    const [wasmBytes, sab] = await Promise.all([
      FilterVizWasmBytes.get(),
      this.fmSynth.getFilterVizSAB(),
    ]);
    if (this.destroyed || !sab) {
      return;
    }

    this.post({ type: 'setWasmBytes', wasmBytes, sab });
    this.post({ type: 'setFilterType', filterType: this.filterType });
    this.post({ type: 'setActive', active: this.active });
    this.fmSynth.setFilterVizActive(this.active);
    this.ready = true;

    if (this.pendingCanvas) {
      this.sendCanvas(this.pendingCanvas.canvas, this.pendingCanvas.dpr);
      this.pendingCanvas = null;
    }
  }

  private sendCanvas(canvas: OffscreenCanvas, dpr: number) {
    this.post(
      {
        type: 'setCanvas',
        canvas,
        dpr,
        dbDomain: FILTER_VIZ_DB_DOMAIN,
        lineColor: FILTER_VIZ_LINE_COLOR,
      },
      [canvas]
    );
  }

  public setCanvas(canvas: OffscreenCanvas, dpr: number) {
    if (this.ready) {
      this.sendCanvas(canvas, dpr);
    } else {
      this.pendingCanvas = { canvas, dpr };
    }
  }

  public setFilterType(filterType: number) {
    this.filterType = filterType;
    if (this.ready) {
      this.post({ type: 'setFilterType', filterType });
    }
  }

  public setActive(active: boolean) {
    this.active = active;
    if (this.ready) {
      this.post({ type: 'setActive', active });
      this.fmSynth.setFilterVizActive(active);
    }
  }

  public destroy() {
    this.destroyed = true;
    if (this.ready) {
      this.fmSynth.setFilterVizActive(false);
    }
    this.worker.terminate();
  }
}
