import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { getSentry } from 'src/sentry';
import { FilterType } from 'src/synthDesigner/FilterType';
import {
  type AbstractFilterModule,
  buildConnectedFilterChain,
  computeHigherOrderBiquadQFactors,
} from 'src/synthDesigner/biquadFilterModule';
import { AsyncOnce } from 'src/util';

const ctx = new AudioContext();

const DynaBandPassFilterAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'DynaBandpassFilterAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? btoa(Math.random().toString()) : '')
    ),
  true
);

/**
 * A bandpass filter constructed out of a higher-order lowpass and highpass filter.  The bandwidth is adjusted dynamically
 * to be larger at higher center frequencies to match the logarithmic nature of frequencies.
 */
export class DynaBandPassFilter {
  private awpHandle: AudioWorkletNode | null = null;
  private fullFilterChain: BiquadFilterNode[] | null = null;
  private pendingOnInitCbs: (() => void)[] = [];

  constructor(order: number) {
    this.init(order).catch(err => {
      console.error('DynaBandPassFilter init error', err);
      getSentry()?.captureException(err);
    });
  }

  private async init(order: number) {
    const awpRegisteredProm = DynaBandPassFilterAWPRegistered.get();

    const lowPassFilterChain = buildConnectedFilterChain(
      ctx,
      FilterType.Lowpass,
      computeHigherOrderBiquadQFactors(order)
    );
    const highPassFilterChain = buildConnectedFilterChain(
      ctx,
      FilterType.Highpass,
      computeHigherOrderBiquadQFactors(order)
    );

    // connect the two filter chains in series
    lowPassFilterChain[lowPassFilterChain.length - 1].connect(highPassFilterChain[0]);

    await awpRegisteredProm;
    this.awpHandle = new AudioWorkletNode(ctx, 'dyna-bandpass-filter-awp', {
      channelCount: 1,
      numberOfInputs: 0,
      numberOfOutputs: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    });
    this.awpHandle.addEventListener('processorerror', e => {
      console.error('DynaBandPassFilterAWP processor error', e);
    });

    // output 0 is low pass filter frequency
    // output 1 is high pass filter frequency
    for (const lpFilter of lowPassFilterChain) {
      this.awpHandle.connect(lpFilter.frequency, 0);
    }
    for (const hpFilter of highPassFilterChain) {
      this.awpHandle.connect(hpFilter.frequency, 1);
    }

    this.fullFilterChain = [...lowPassFilterChain, ...highPassFilterChain];

    for (const cb of this.pendingOnInitCbs) {
      cb();
    }
    this.pendingOnInitCbs = [];
  }

  public onInit(): Promise<void> {
    if (this.fullFilterChain) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      this.pendingOnInitCbs.push(resolve);
    });
  }

  public getCenterFrequencyParam() {
    if (!this.awpHandle) {
      throw new Error('DynaBandPassFilter not yet initialized');
    }

    return (this.awpHandle.parameters as Map<string, AudioParam>).get('center_frequency')!;
  }

  public getBandwidthParam() {
    if (!this.awpHandle) {
      throw new Error('DynaBandPassFilter not yet initialized');
    }

    return (this.awpHandle.parameters as Map<string, AudioParam>).get('base_band_width')!;
  }

  public getInput() {
    if (!this.fullFilterChain) {
      throw new Error('DynaBandPassFilter not yet initialized');
    }

    return this.fullFilterChain[0];
  }

  public getOutput() {
    if (!this.fullFilterChain) {
      throw new Error('DynaBandPassFilter not yet initialized');
    }

    return this.fullFilterChain[this.fullFilterChain.length - 1];
  }

  public destroy() {
    this.awpHandle?.disconnect();
    this.fullFilterChain?.forEach(filter => filter.disconnect());
  }
}

export class DynaBandpassFilterWrapper implements AbstractFilterModule {
  private inner: DynaBandPassFilter;

  // Need to add some indirection to deal with async initialization
  private input: GainNode;
  private output: GainNode;
  private centerFrequencyInput: ConstantSourceNode;

  constructor(
    filterType:
      | FilterType.DynaBP_50
      | FilterType.DynaBP_100
      | FilterType.DynaBP_200
      | FilterType.DynaBP_400
      | FilterType.DynaBP_800,
    frequency: OverridableAudioParam
  ) {
    this.input = ctx.createGain();
    this.input.gain.value = 1;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.centerFrequencyInput = ctx.createConstantSource();
    this.centerFrequencyInput.offset.value = 0;
    this.centerFrequencyInput.start();

    const { bandWidth, order } = {
      [FilterType.DynaBP_50]: { order: 8, bandWidth: 50 },
      [FilterType.DynaBP_100]: { order: 8, bandWidth: 100 },
      [FilterType.DynaBP_200]: { order: 8, bandWidth: 200 },
      [FilterType.DynaBP_400]: { order: 8, bandWidth: 400 },
      [FilterType.DynaBP_800]: { order: 8, bandWidth: 800 },
    }[filterType] as { order: number; bandWidth: number };

    this.inner = new DynaBandPassFilter(order);
    this.inner.onInit().then(() => {
      this.input.connect(this.inner.getInput());

      this.inner.getOutput().connect(this.output);
      this.inner.getBandwidthParam().value = bandWidth;

      this.centerFrequencyInput.connect(this.inner.getCenterFrequencyParam());
      frequency.connect(this.inner.getCenterFrequencyParam());

      this.output.gain.value = 1;
    });
  }

  public getInput(): AudioNode {
    return this.input;
  }
  public getOutput(): AudioNode {
    return this.output;
  }

  public getFrequencyParams(): AudioParam[] {
    return [this.centerFrequencyInput.offset];
  }

  public destroy() {
    this.inner.destroy();
  }
}
