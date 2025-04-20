import * as R from 'ramda';
import * as Comlink from 'comlink';

import type { EqualizerBand, EqualizerState } from 'src/equalizer/equalizer';
import type { EqualizerWorker } from 'src/equalizer/equalizerWorker.worker';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { AsyncOnce, type TransparentWritable } from 'src/util';
import type { Unsubscriber } from 'svelte/store';

const RESPONSES_GRID_SIZE = 1024;

const EqualizerAWPInitialized = new AsyncOnce(
  () =>
    new AudioContext().audioWorklet.addModule(
      process.env.ASSET_PATH +
        'EqualizerAWP.js?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);
const EqualizerWasm = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'equalizer.wasm?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);

export class EqualizerInstance {
  private ctx: AudioContext;
  public vcId: string;
  public state: EqualizerState;
  private uiState: TransparentWritable<{ hidden: boolean }>;
  private unsubscribeUIState: Unsubscriber;
  public awpHandle: AudioWorkletNode | DummyNode;
  private worker: Comlink.Remote<EqualizerWorker>;
  private workerReadyP!: Promise<void>;
  private ready = false;

  constructor(
    ctx: AudioContext,
    vcId: string,
    initialState: EqualizerState,
    uiState: TransparentWritable<{ hidden: boolean }>
  ) {
    this.ctx = ctx;
    this.vcId = vcId;
    this.state = R.clone(initialState);
    this.uiState = uiState;
    this.unsubscribeUIState = uiState.subscribe(_newUIState => {
      this.maybeComputeAndPlotResponse();
    });
    this.awpHandle = new DummyNode('equalizer');
    this.worker = Comlink.wrap(new Worker(new URL('./equalizerWorker.worker.ts', import.meta.url)));

    this.init();
  }

  private async init() {
    const [wasmBytes] = await Promise.all([EqualizerWasm.get(), EqualizerAWPInitialized.get()]);
    this.workerReadyP = this.worker.setWasmBytes(wasmBytes);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'equalizer-awp', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });
    this.awpHandle.port.onmessage = (evt: MessageEvent) => this.handleAWPMessage(evt);
    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });
  }

  private async handleAWPMessage(evt: MessageEvent) {
    const awpHandle = this.awpHandle as AudioWorkletNode;

    switch (evt.data.type) {
      case 'ready': {
        await this.workerReadyP;
        awpHandle.port.postMessage({ type: 'setInitialState', state: this.state });
        this.worker.setInitialState(this.state);
        this.ready = true;
        this.maybeComputeAndPlotResponse();
        break;
      }
      default:
        console.warn('Unknown message type from Equalizer AWP: ', evt.data.type);
    }
  }

  public maybeComputeAndPlotResponse = async () => {
    if (this.uiState.current.hidden || !this.ready) {
      return;
    }

    const bgContainer: HTMLDivElement | null = document.getElementById(
      `equalizer-bg-${this.vcId}`
    ) as any;
    if (!bgContainer) {
      return;
    }
    const svg: SVGSVGElement = bgContainer.getElementsByClassName('eq-mag-response-plot')[0] as any;
    const path: SVGPathElement = svg.getElementsByClassName('eq-mag-response-plot-path')[0] as any;

    const responses = await this.worker.computeResponses(
      RESPONSES_GRID_SIZE,
      bgContainer.clientWidth,
      bgContainer.clientHeight
    );
    path.setAttribute('d', responses.magResponsePath);
  };

  public setBand(bandIx: number, band: EqualizerBand) {
    this.state.bands[bandIx] = band;
    if (this.ready) {
      (this.awpHandle as AudioWorkletNode).port.postMessage({ type: 'setBand', bandIx, band });
      this.worker.setBand(bandIx, band);
      this.maybeComputeAndPlotResponse();
    }
  }

  public serialize(): EqualizerState {
    return R.clone(this.state);
  }

  public shutdown() {
    if (this.awpHandle instanceof AudioWorkletNode) {
      this.awpHandle.port.postMessage({ type: 'shutdown' });
    }
    this.unsubscribeUIState();
  }
}
