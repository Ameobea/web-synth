import * as R from 'ramda';
import * as Comlink from 'comlink';
import { Map as ImmMap } from 'immutable';

import type { EqualizerBand, EqualizerState } from 'src/equalizer/equalizer';
import type { EqualizerWorker } from 'src/equalizer/equalizerWorker.worker';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { AsyncOnce, rwritable, type TransparentWritable } from 'src/util';
import type { Unsubscriber } from 'svelte/store';
import { EQ_AXIS_MARGIN, EQ_MAX_AUTOMATED_PARAM_COUNT } from 'src/equalizer/conf';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { OverridableAudioNode } from 'src/graphEditor/nodes/util';
import { getValidParamsForFilterType } from 'src/equalizer/eqHelpers';

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
  /**
   * Holds the last seen value from the audio thread for each automation slot
   */
  public automationValsSAB: TransparentWritable<Float32Array | null> = rwritable(null);
  private bandOANs: {
    freq: OverridableAudioNode;
    q: OverridableAudioNode;
    gain: OverridableAudioNode;
  }[] = [];
  public uiState: TransparentWritable<{ hidden: boolean }>;
  private unsubscribeUIState: Unsubscriber;
  public awpHandle: AudioWorkletNode | DummyNode;
  private worker: Comlink.Remote<EqualizerWorker>;
  private workerReadyP!: Promise<void>;
  private ready = false;
  /**
   * For efficiency, a sparse mapping of automated params is used rather than creating an audio param
   * for each of the bands' params.
   *
   * This array specifies which param from which band is automated by each of the available automation
   * params.  An entry of `{ bandIx: 0, param: 'freq' }` means that the first automation param is
   * automating the frequency of the first band.
   */
  public automatedParams: TransparentWritable<
    ({ bandIx: number; param: 'freq' | 'q' | 'gain' } | null)[]
  > = rwritable(new Array(EQ_MAX_AUTOMATED_PARAM_COUNT).fill(null));
  private responseAnimationFrameHandle: number | null = null;

  constructor(
    ctx: AudioContext,
    vcId: string,
    initialState: EqualizerState,
    uiState: TransparentWritable<{ hidden: boolean }>
  ) {
    this.ctx = ctx;
    this.vcId = vcId;
    this.state = rwritable(R.clone(initialState));
    this.bandOANs = initialState.bands.map((_band, bandIx) => this.buildOANsForBand(bandIx));
    this.uiState = uiState;
    this.unsubscribeUIState = uiState.subscribe(_newUIState => {
      this.maybeComputeAndPlotResponse();
      this.maybeStartOrStopResponseAnimation();
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

    for (
      let automationSlotIx = 0;
      automationSlotIx < EQ_MAX_AUTOMATED_PARAM_COUNT;
      automationSlotIx += 1
    ) {
      const slot = this.automatedParams.current[automationSlotIx];
      if (!slot) {
        continue;
      }

      const node = this.bandOANs[slot.bandIx][slot.param];
      const param = (this.awpHandle.parameters as Map<string, AudioParam>).get(
        `automation_${automationSlotIx}`
      )!;
      node.output.connect(param);
    }

    this.awpHandle.port.onmessage = (evt: MessageEvent) => this.handleAWPMessage(evt);
    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });
    updateConnectables(this.vcId, this.buildAudioConnectables());
  }

  private buildOANsForBand = (bandIx: number) => {
    const freq = new OverridableAudioNode(this.ctx, undefined, true);
    const q = new OverridableAudioNode(this.ctx, undefined, true);
    const gain = new OverridableAudioNode(this.ctx, undefined, true);

    const mkOverrideStatusChangeCb =
      (paramType: 'freq' | 'q' | 'gain', node: OverridableAudioNode) => (isOverridden: boolean) =>
        this.handleBandParamOverrideStatusChange(bandIx, paramType, node.output, !isOverridden);

    freq.registerOverrideStatusChangeCb(mkOverrideStatusChangeCb('freq', freq));
    q.registerOverrideStatusChangeCb(mkOverrideStatusChangeCb('q', q));
    gain.registerOverrideStatusChangeCb(mkOverrideStatusChangeCb('gain', gain));

    return { freq, q, gain };
  };

  private handleBandParamOverrideStatusChange = (
    bandIx: number,
    paramType: 'freq' | 'q' | 'gain',
    node: AudioNode,
    isAutomated: boolean
  ) => {
    const existingIx = this.automatedParams.current.findIndex(
      p => p && p.bandIx === bandIx && p.param === paramType
    );

    const newAutomatedParams = [...this.automatedParams.current];

    if (isAutomated) {
      if (existingIx !== -1) {
        console.warn(`OverridableAudioNode: ${paramType} for band ${bandIx} is already automated`);
        return;
      }
      const emptySlotIx = this.automatedParams.current.findIndex(p => p === null);
      if (emptySlotIx === -1) {
        toastError(
          `All available automation slots are in use by the equalizer.  The max number of automatable params is ${EQ_MAX_AUTOMATED_PARAM_COUNT}.`
        );
        return;
      }
      newAutomatedParams[emptySlotIx] = { bandIx, param: paramType };
      if (this.awpHandle instanceof AudioWorkletNode) {
        const param = (this.awpHandle.parameters as Map<string, AudioParam>).get(
          `automation_${emptySlotIx}`
        )!;
        console.log('connecting in status change cb');
        node.connect(param);
      }
    } else {
      if (existingIx === -1) {
        console.warn(`OverridableAudioNode: ${paramType} for band ${bandIx} is not automated`);
        return;
      }
      newAutomatedParams[existingIx] = null;
      if (this.awpHandle instanceof AudioWorkletNode) {
        const param = (this.awpHandle.parameters as Map<string, AudioParam>).get(
          `automation_${existingIx}`
        )!;
        node.disconnect(param);
      }
    }

    this.automatedParams.set(newAutomatedParams);

    if (this.awpHandle instanceof AudioWorkletNode) {
      for (let bandIx = 0; bandIx < this.state.current.bands.length; bandIx += 1) {
        const bandWithAutomationBufIxs = this.buildAWPBandState(bandIx);
        this.awpHandle.port.postMessage({
          type: 'setBand',
          bandIx,
          band: bandWithAutomationBufIxs,
        });
        this.worker.setBand(bandIx, bandWithAutomationBufIxs);
      }
    }

    setTimeout(() => updateConnectables(this.vcId, this.buildAudioConnectables()));

    this.maybeStartOrStopResponseAnimation();
  };

  private buildAWPBandState = (bandIx: number) => {
    const band = this.state.current.bands[bandIx];

    const freqAutomationBufIx = this.automatedParams.current.findIndex(
      p => p && p.bandIx === bandIx && p.param === 'freq'
    );
    const qAutomationBufIx = this.automatedParams.current.findIndex(
      p => p && p.bandIx === bandIx && p.param === 'q'
    );
    const gainAutomationBufIx = this.automatedParams.current.findIndex(
      p => p && p.bandIx === bandIx && p.param === 'gain'
    );

    return {
      ...band,
      freqAutomationBufIx,
      qAutomationBufIx,
      gainAutomationBufIx,
    };
  };

  private async handleAWPMessage(evt: MessageEvent) {
    const awpHandle = this.awpHandle as AudioWorkletNode;

    switch (evt.data.type) {
      case 'ready': {
        await this.workerReadyP;
        const bandsWithAutomationBufIxs = this.state.current.bands.map((_band, bandIx) =>
          this.buildAWPBandState(bandIx)
        );
        awpHandle.port.postMessage({
          type: 'setInitialState',
          state: { bands: bandsWithAutomationBufIxs },
        });
        this.worker.setInitialState({
          ...this.state.current,
          bands: bandsWithAutomationBufIxs,
        });
        this.ready = true;
        this.maybeComputeAndPlotResponse();
        updateConnectables(this.vcId, this.buildAudioConnectables());
        break;
      }
      case 'setAutomationSAB': {
        this.automationValsSAB.set(evt.data.sab);
        this.worker.setAutomationValsSAB(evt.data.sab);
        // need to re-post the bands to the worker after receiving the SAB because fallback
        // defaults to rendering manually set values if SAB support is not available
        for (let bandIx = 0; bandIx < this.state.current.bands.length; bandIx += 1) {
          const bandWithAutomationBufIxs = this.buildAWPBandState(bandIx);
          this.worker.setBand(bandIx, bandWithAutomationBufIxs);
        }
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
    const needsConnectablesUpdate =
      this.state.current.bands[bandIx].filterType !== newBand.filterType;

    this.state.update(state => {
      const newState = { ...state, bands: [...state.bands] };
      newState.bands[bandIx] = newBand;
      return newState;
    });
    if (this.ready) {
      (this.awpHandle as AudioWorkletNode).port.postMessage({
        type: 'setBand',
        bandIx,
        band: this.buildAWPBandState(bandIx),
      });
      this.worker.setBand(bandIx, this.buildAWPBandState(bandIx));
      this.maybeComputeAndPlotResponse();
    }

    if (needsConnectablesUpdate) {
      updateConnectables(this.vcId, this.buildAudioConnectables());
    }
  }

  private animateResponse = () => {
    this.maybeComputeAndPlotResponse();
    this.responseAnimationFrameHandle = requestAnimationFrame(this.animateResponse);
  };

  private maybeStartOrStopResponseAnimation = () => {
    const isHidden = this.uiState.current.hidden;
    const hasAutomatedParam = this.automatedParams.current.some(p => p !== null);
    const shouldAnimate = !isHidden && hasAutomatedParam;

    if (shouldAnimate && !this.responseAnimationFrameHandle) {
      this.responseAnimationFrameHandle = requestAnimationFrame(this.animateResponse);
    } else if (!shouldAnimate && this.responseAnimationFrameHandle) {
      cancelAnimationFrame(this.responseAnimationFrameHandle);
      this.responseAnimationFrameHandle = null;
    }
  };

  public buildAudioConnectables(): AudioConnectables {
    let inputs = ImmMap<string, ConnectableInput>().set('input', {
      type: 'customAudio',
      node: this.awpHandle,
    });
    const outputs = ImmMap<string, ConnectableOutput>().set('output', {
      type: 'customAudio',
      node: this.awpHandle,
    });

    for (let bandIx = 0; bandIx < this.state.current.bands.length; bandIx += 1) {
      const filterType = this.state.current.bands[bandIx].filterType;
      const params = getValidParamsForFilterType(filterType);
      for (const param of params) {
        inputs = inputs.set(`band_${bandIx}_${param}`, {
          type: 'number',
          node: this.bandOANs[bandIx][param],
        });
      }
    }

    return {
      vcId: this.vcId,
      inputs,
      outputs,
    };
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
