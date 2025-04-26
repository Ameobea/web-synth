import * as R from 'ramda';
import * as Comlink from 'comlink';

import type { EqualizerBand, EqualizerState } from 'src/equalizer/equalizer';
import type { EqualizerWorker } from 'src/equalizer/equalizerWorker.worker';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { AsyncOnce, rwritable, type TransparentWritable } from 'src/util';
import type { Unsubscriber } from 'svelte/store';
import { EQ_AXIS_MARGIN } from 'src/equalizer/conf';

const RESPONSES_GRID_SIZE = 256;

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
  public state: TransparentWritable<EqualizerState>;
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
    this.state = rwritable(R.clone(initialState));
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
        awpHandle.port.postMessage({ type: 'setInitialState', state: this.state.current });
        this.worker.setInitialState(this.state.current);
        this.ready = true;
        this.maybeComputeAndPlotResponse();
        break;
      }
      default:
        console.warn('Unknown message type from Equalizer AWP: ', evt.data.type);
    }
  }

  // avoid adding delay to the response plot by building up a queue of compute requests
  //
  // instead, only keep the most recent request and cancel all previous ones
  private curResponseComputePromise: Promise<any> | null = null;
  private computeResponseSeq: number = 0;

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

    const seq = ++this.computeResponseSeq;
    if (this.curResponseComputePromise) {
      await this.curResponseComputePromise;
    }

    // if a more recent response compute is in progress, cancel this one
    if (seq !== this.computeResponseSeq) {
      return;
    }

    const promise = this.worker.computeResponses(
      RESPONSES_GRID_SIZE,
      bgContainer.clientWidth - EQ_AXIS_MARGIN.left - EQ_AXIS_MARGIN.right,
      bgContainer.clientHeight - EQ_AXIS_MARGIN.top - EQ_AXIS_MARGIN.bottom
    );
    this.curResponseComputePromise = promise;
    const responses = await promise;
    if (!responses) {
      return;
    }

    const svg: SVGSVGElement = bgContainer.getElementsByClassName('eq-mag-response-plot')[0] as any;
    const path: SVGPathElement = svg.getElementsByClassName('eq-mag-response-plot-path')[0] as any;
    path.setAttribute('d', responses.magResponsePath);
  };

  public setBand(bandIx: number, newBand: EqualizerBand) {
    this.state.update(state => {
      const newState = { ...state, bands: [...state.bands] };
      newState.bands[bandIx] = newBand;
      return newState;
    });
    if (this.ready) {
      (this.awpHandle as AudioWorkletNode).port.postMessage({
        type: 'setBand',
        bandIx,
        band: newBand,
      });
      this.worker.setBand(bandIx, newBand);
      this.maybeComputeAndPlotResponse();
    }
  }

  public serialize(): EqualizerState {
    return R.clone(this.state.current);
  }

  public shutdown() {
    if (this.awpHandle instanceof AudioWorkletNode) {
      this.awpHandle.port.postMessage({ type: 'shutdown' });
    }
    this.unsubscribeUIState();
  }
}
