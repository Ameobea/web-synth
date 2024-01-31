import * as R from 'ramda';

import { buildDefaultAdsrEnvelope, type ADSRValues } from 'src/controls/adsr';
import type { AudioThreadData } from 'src/controls/adsr2/adsr2';
import {
  AdsrLengthMode,
  type Adsr,
  type AdsrStep,
} from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import { getSentry } from 'src/sentry';
import { AsyncOnce, UnreachableError, msToSamples, samplesToMs } from 'src/util';

const ADSR2AWPRegistered = new AsyncOnce(
  () =>
    new AudioContext().audioWorklet.addModule(
      process.env.ASSET_PATH +
        'ADSR2AWP.js' +
        (window.location.href.includes('localhost')
          ? ''
          : '?cacheBust=' + btoa(Math.random().toString()))
    ),
  true
);
const ADSRWasm = new AsyncOnce(() => {
  const url =
    process.env.ASSET_PATH +
    'adsr.wasm' +
    (window.location.href.includes('localhost')
      ? ''
      : `?cacheBust=${btoa(Math.random().toString())}`);
  return fetch(url).then(res => res.arrayBuffer());
}, true);

export interface ADSR2Params {
  minValue?: number;
  maxValue?: number;
  length: number;
  lengthMode: AdsrLengthMode;
  loopPoint?: number | null;
  releaseStartPhase: number;
  steps: AdsrStep[];
  logScale?: boolean;
}

export enum EarlyReleaseModeType {
  LinearMix = 0,
  FastEnvelopeFollow = 1,
  Freeze = 2,
}

export interface EarlyReleaseMode {
  type: EarlyReleaseModeType;
  param: number;
}

export class ADSR2Module {
  private ctx: AudioContext;
  private outputRange: [number, number];
  private earlyReleaseMode: EarlyReleaseMode;
  private awp: AudioWorkletNode | undefined;
  /**
   * Params that will be sent to the AWP to initialize it
   */
  private params: ADSR2Params;
  private onInitializedCbs: (() => void)[] = [];
  public audioThreadData: AudioThreadData;

  constructor(
    ctx: AudioContext,
    params: ADSR2Params,
    instanceCount: number,
    audioThreadData?: AudioThreadData,
    earlyReleaseMode: EarlyReleaseMode = { type: EarlyReleaseModeType.LinearMix, param: 6640 }
  ) {
    this.ctx = ctx;
    this.outputRange = [params.minValue ?? 0, params.maxValue ?? 1];
    this.earlyReleaseMode = earlyReleaseMode;
    this.params = params;
    this.audioThreadData = audioThreadData ?? {
      phaseIndex: 0,
      debugName: 'NO AUDIO THREAD DATA PROVDED FOR `ADSR2Module`',
    };
    this.init(instanceCount).catch(err => {
      console.error('Error initializing ADSR2Module: ', err);
      getSentry()?.captureException(err);
    });
  }

  private static encodeADSRSteps(steps: AdsrStep[]): Float32Array {
    const encoded = new Float32Array(steps.length * 4);
    steps.forEach((step, i) => {
      encoded[i * 4] = step.x;
      encoded[i * 4 + 1] = step.y;
      encoded[i * 4 + 2] = { instant: 0, linear: 1, exponential: 2 }[step.ramper.type];
      encoded[i * 4 + 3] = step.ramper.type === 'exponential' ? step.ramper.exponent : 0;
    });
    return encoded;
  }

  private async init(instanceCount: number) {
    const [wasmBytes] = await Promise.all([ADSRWasm.get(), ADSR2AWPRegistered.get()] as const);
    this.awp = new AudioWorkletNode(this.ctx, 'multi-adsr2-awp', {
      numberOfOutputs: instanceCount,
      numberOfInputs: 0,
      outputChannelCount: new Array(instanceCount).fill(1),
      processorOptions: { instanceCount },
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    });
    this.awp.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'phaseDataBuffer': {
          if (!this.audioThreadData) {
            console.warn(
              '`audioThreadData` was nil in `ADSR2Module` event handler for `phaseDataBuffer` event handler'
            );
            break;
          }
          this.audioThreadData.buffer = new Float32Array(
            evt.data.phaseDataBuffer as SharedArrayBuffer
          );
          this.onInitializedCbs.forEach(cb => cb());
          this.onInitializedCbs = [];
          break;
        }
        default: {
          console.error('Unhandled message type from ADSR2 AWP: ', evt.data.type);
        }
      }
    };
    this.awp.port.postMessage({
      type: 'setWasmBytes',
      wasmBytes,
      encodedSteps: ADSR2Module.encodeADSRSteps(this.params.steps),
      releaseStartPhase: this.params.releaseStartPhase,
      loopPoint: this.params.loopPoint,
      length: (() => {
        switch (this.params.lengthMode) {
          case AdsrLengthMode.Samples:
          case undefined:
            return samplesToMs(this.params.length);
          case AdsrLengthMode.Beats:
            return this.params.length;
          default:
            throw new UnreachableError(`Unhandled length mode: ${this.params.lengthMode}`);
        }
      })(),
      lengthMode: this.params.lengthMode,
      outputRange: this.outputRange,
      logScale: this.params.logScale ?? false,
      earlyReleaseModeType: this.earlyReleaseMode.type,
      earlyReleaseModeParam: this.earlyReleaseMode.param,
    });
  }

  /**
   * Only returns `undefined` if the AWP is not initialized yet
   */
  public async getOutput(): Promise<AudioWorkletNode> {
    if (this.awp) {
      return this.awp;
    }

    return new Promise(resolve => {
      this.onInitializedCbs.push(() => resolve(this.awp!));
    });
  }

  public getOutputSync(): AudioWorkletNode | undefined {
    return this.awp;
  }

  public onInit(): Promise<void> {
    if (this.awp) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      this.onInitializedCbs.push(() => resolve());
    });
  }

  public setState(newState: Adsr) {
    this.setSteps(newState.steps);
    this.setLoopPoint(newState.loopPoint);
    this.setReleaseStartPhase(newState.releasePoint);
    // this.setLength(newState.lengthMode, newState.lenSamples);
    this.setLogScale(newState.logScale ?? false);
  }

  public setSteps(newSteps: AdsrStep[]) {
    this.params.steps = newSteps;
    if (!this.awp) {
      return;
    }
    const encodedSteps = ADSR2Module.encodeADSRSteps(newSteps);
    this.awp.port.postMessage({ type: 'setSteps', encodedSteps });
  }

  public setLoopPoint(newLoopPoint: number | null | undefined) {
    this.params.loopPoint = newLoopPoint;
    if (!this.awp) {
      return;
    }
    this.awp.port.postMessage({ type: 'setLoopPoint', loopPoint: newLoopPoint });
  }

  public setReleaseStartPhase(newReleaseStartPhase: number) {
    this.params.releaseStartPhase = newReleaseStartPhase;
    if (!this.awp) {
      return;
    }
    this.awp.port.postMessage({
      type: 'setReleaseStartPhase',
      releaseStartPhase: newReleaseStartPhase,
    });
  }

  public setLength(lengthMode: AdsrLengthMode | undefined, newLength: number) {
    this.params.lengthMode = lengthMode ?? AdsrLengthMode.Samples;
    this.params.length = newLength;
    if (!this.awp) {
      return;
    }

    this.awp.port.postMessage({
      type: 'setLength',
      length: (() => {
        switch (lengthMode) {
          case AdsrLengthMode.Samples:
          case undefined:
            return samplesToMs(newLength);
          case AdsrLengthMode.Beats:
            return newLength;
          default:
            throw new UnreachableError(`Unhandled length mode: ${lengthMode}`);
        }
      })(),
      lengthMode: lengthMode ?? AdsrLengthMode.Samples,
    });
  }

  public setLengthMs(newLengthMs: number) {
    const newLengthSamples = msToSamples(newLengthMs);
    this.setLength(AdsrLengthMode.Samples, newLengthSamples);
  }

  public setLogScale(logScale: boolean) {
    this.params.logScale = logScale;
    if (!this.awp) {
      return;
    }
    this.awp.port.postMessage({ type: 'setLogScale', logScale });
  }

  public getReleaseStartPhase(): number {
    return this.params.releaseStartPhase;
  }

  public getLengthMs(): number {
    if (this.params.lengthMode === AdsrLengthMode.Samples) {
      return samplesToMs(this.params.length);
    } else {
      console.error('Tried to get ADSR2 length in ms when length mode is not samples');
      return 100;
    }
  }

  public getSteps(): AdsrStep[] {
    return this.params.steps;
  }

  public setOutputRange([minVal, maxVal]: [number, number]) {
    this.outputRange = [minVal, maxVal];
    if (!this.awp) {
      return;
    }
    this.awp.port.postMessage({ type: 'setOutputRange', outputRange: [minVal, maxVal] });
  }

  public setFrozenOutputValue(newFrozenOutputValue: number) {
    if (!this.awp) {
      console.error('Tried to set ADSR2 frozen output value before AWP initialized');
      return;
    }
    this.awp.port.postMessage({ type: 'setFrozenOutputValue', value: newFrozenOutputValue });
  }

  public setFrozenOutputValueFromPhase(phase: number) {
    if (!this.awp) {
      console.error('Tried to set ADSR2 frozen output value from phase before AWP initialized');
      return;
    }
    this.awp.port.postMessage({ type: 'setFrozenOutputValueFromPhase', phase });
  }

  public gate(adsrIndex: number) {
    if (!this.awp) {
      console.error('Failed to gate ADSR2 due to AWP not being initialized');
      return;
    }
    this.awp.port.postMessage({ type: 'gate', index: adsrIndex });
  }

  public ungate(adsrIndex: number) {
    if (!this.awp) {
      console.error('Failed to ungate ADSR2 due to AWP not being initialized');
      return;
    }
    this.awp.port.postMessage({ type: 'ungate', index: adsrIndex });
  }

  public serialize(): Adsr {
    return {
      steps: R.clone(this.params.steps),
      lenSamples: this.params.length,
      loopPoint: this.params.loopPoint ?? null,
      releasePoint: this.params.releaseStartPhase ?? null,
      audioThreadData: { phaseIndex: 0, debugName: 'ADSR2Module.serialize()' },
      logScale: this.params.logScale ?? false,
    };
  }

  public destroy() {
    if (!this.awp) {
      this.onInit().then(() => this.destroy());
      return;
    }
    this.awp.disconnect();
    this.awp.port.postMessage({ type: 'shutdown' });
  }
}

export class ADSRModule extends ConstantSourceNode {
  private ctx: AudioContext;
  public minValue: number;
  public maxValue: number;
  public lengthMs = 1000;
  public envelope: ADSRValues = buildDefaultAdsrEnvelope();

  constructor(
    ctx: AudioContext,
    {
      minValue = 0,
      maxValue = 1,
      lengthMs = 1000,
    }: { minValue?: number; maxValue?: number; lengthMs?: number }
  ) {
    super(ctx);

    this.ctx = ctx;
    this.minValue = minValue;
    this.maxValue = maxValue;
    this.lengthMs = lengthMs;

    this.offset.setValueAtTime(this.minValue, ctx.currentTime);
  }

  public setLengthMs(newLengthMs: number) {
    this.lengthMs = newLengthMs;
  }

  public setMinValue(newMinValue: number) {
    this.minValue = newMinValue;
  }

  public setMaxValue(newMaxValue: number) {
    this.maxValue = newMaxValue;
  }

  public setEnvelope(newEnvelope: ADSRValues) {
    this.envelope = newEnvelope;
  }

  /**
   * Triggers the ADSR to implement the signal, triggering ramps to each of the levels defined by the envelope to the
   * underlying `ConstantSourceNode` and effecting all connected `AudioParam`s
   */
  public gate() {
    if (!this.lengthMs) {
      console.warn('Tried to gate ADSR before value recorder initialized');
      return;
    }

    this.offset.cancelScheduledValues(0);

    const range = this.maxValue - this.minValue;
    const { attack, decay } = this.envelope;

    // Ramp to the attack
    if (attack.pos > 0) {
      // Firefox is 100% broken for exponential ramping and seems to have serious bugs for various `AudioParam`
      // methods including `exponentialRampToValueAtTime` and possibly `setValueCurveAtTime` and `cancelScheduledValues`.
      if (navigator.userAgent.includes('Firefox/')) {
        this.offset.linearRampToValueAtTime(
          this.minValue + attack.magnitude * range,
          this.ctx.currentTime + (attack.pos * this.lengthMs) / 1000.0
        );
      } else {
        this.offset.exponentialRampToValueAtTime(
          Math.max(this.minValue + attack.magnitude * range, 0.0001),
          this.ctx.currentTime + (attack.pos * this.lengthMs) / 1000.0
        );
      }
    } else {
      this.offset.setValueAtTime(this.minValue + attack.magnitude * range, this.ctx.currentTime);
    }
    // Ramp to the decay and hold there
    if (decay.pos - attack.pos > 0) {
      if (navigator.userAgent.includes('Firefox/')) {
        this.offset.linearRampToValueAtTime(
          this.minValue + decay.magnitude * range,
          this.ctx.currentTime + (decay.pos * this.lengthMs) / 1000.0
        );
      } else {
        this.offset.exponentialRampToValueAtTime(
          Math.max(this.minValue + decay.magnitude * range, 0.0001),
          this.ctx.currentTime + (decay.pos * this.lengthMs) / 1000.0
        );
      }
    } else {
      this.offset.setValueAtTime(this.minValue + decay.magnitude * range, this.ctx.currentTime);
    }
  }

  /**
   * Triggers the start of the release.  This will override all other envelope ramp events that are currently queued
   * and start ramping to zero immediately.
   */
  public ungate() {
    if (!this.lengthMs) {
      console.warn('Tried to ungate ADSR before value recorder initialized');
      return;
    }

    const { release } = this.envelope;

    // Clear any queued ramp events
    this.offset.cancelScheduledValues(0);

    const releaseDuration = ((1.0 - release.pos) * this.lengthMs) / 1000.0;
    if (navigator.userAgent.includes('Firefox/')) {
      this.offset.linearRampToValueAtTime(
        this.minValue,
        this.ctx.currentTime + releaseDuration * 0.35 // shorten the release since linear releases sound way longer
      );
    } else {
      this.offset.exponentialRampToValueAtTime(
        this.minValue === 0 ? 0.0001 : this.minValue,
        this.ctx.currentTime + releaseDuration
      );
    }
  }
}
