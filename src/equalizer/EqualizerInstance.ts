import * as R from 'ramda';
import * as Comlink from 'comlink';

import type { EqualizerBand, EqualizerState } from 'src/equalizer/equalizer';
import type { EqualizerWorker } from 'src/equalizer/equalizerWorker.worker';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { AsyncOnce } from 'src/util';

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
  private vcId: string;
  public state: EqualizerState;
  public awpHandle: AudioWorkletNode | DummyNode;
  private worker: Comlink.Remote<EqualizerWorker>;
  private ready = false;

  constructor(ctx: AudioContext, vcId: string, initialState: EqualizerState) {
    this.ctx = ctx;
    this.vcId = vcId;
    this.state = R.clone(initialState);
    this.awpHandle = new DummyNode('equalizer');
    this.worker = Comlink.wrap(new Worker(new URL('./equalizerWorker.worker.ts', import.meta.url)));

    this.init();
  }

  private async init() {
    const [wasmBytes] = await Promise.all([EqualizerWasm.get(), EqualizerAWPInitialized.get()]);
    this.worker.setWasmBytes(wasmBytes);
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

  private handleAWPMessage(evt: MessageEvent) {
    const awpHandle = this.awpHandle as AudioWorkletNode;

    switch (evt.data.type) {
      case 'ready': {
        this.ready = true;
        awpHandle.port.postMessage({ type: 'setInitialState', state: this.state });
        this.worker.setInitialState(this.state);
        // TODO: Compute response + update viz
        break;
      }
      default:
        console.warn('Unknown message type from Equalizer AWP: ', evt.data.type);
    }
  }

  public setBand(bandIx: number, band: EqualizerBand) {
    this.state.bands[bandIx] = band;
    if (this.ready) {
      (this.awpHandle as AudioWorkletNode).port.postMessage({ type: 'setBand', bandIx, band });
      this.worker.setBand(bandIx, band);
      // TODO: Compute response + update viz
    }
  }

  public serialize(): EqualizerState {
    return R.clone(this.state);
  }

  public shutdown() {
    if (this.awpHandle instanceof AudioWorkletNode) {
      this.awpHandle.port.postMessage({ type: 'shutdown' });
    }
  }
}
