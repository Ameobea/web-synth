import { Map } from 'immutable';
import * as R from 'ramda';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import { WavetableWasmBytes } from 'src/graphEditor/nodes/CustomAudio/WaveTable/WavetableWasm';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { AsyncOnce, UnreachableError } from 'src/util';
import WaveTableSmallView from './WaveTableSmallView.svelte';

// Manually generate some waveforms... for science

const SAMPLE_RATE = 44_100;
const baseFrequency = 30; // 30hz

// Number of samples per waveform
const waveformLength = SAMPLE_RATE / baseFrequency;

const bufs: Float32Array[] = R.times(() => new Float32Array(waveformLength), 4);

// sine wave.  The sine function has a period of 2π, and we need to scale that the range of
// (sample_rage / desired_frequency)
for (let x = 0; x < waveformLength; x++) {
  bufs[0][x] = Math.sin(x * ((Math.PI * 2) / waveformLength));
}

// triangle wave; goes from -1 to 1 for one half the period and 1 to -1 for the other half
for (let i = 0; i < waveformLength; i++) {
  // Number of half-periods of this wave that this sample lies on.
  const halfPeriodIx = i / (waveformLength / 2);
  const isClimbing = Math.floor(halfPeriodIx) % 2 == 0;
  let val = 2 * (halfPeriodIx % 1) - 1;
  if (!isClimbing) {
    val = -val;
  }

  bufs[1][i] = val;
}

// square wave; half a period -1, half a period 1
for (let i = 0; i < waveformLength; i++) {
  const halfPeriodIx = i / (waveformLength / 2);
  const isFirstHalf = Math.floor(halfPeriodIx) % 2 == 0;

  bufs[2][i] = isFirstHalf ? -1 : 1;
}

// sawtooth; climb from -1 to 1 over 1 period
for (let i = 0; i < waveformLength; i++) {
  const periodIxFract = (i / waveformLength) % 1;

  bufs[3][i] = periodIxFract * 2 - 1;
}

export type WavetableDef = Float32Array[][];

export const getDefaultWavetableDef = (): WavetableDef => [
  [bufs[0], bufs[1]],
  [bufs[2], bufs[3]],
];

let wavetableWasmInstance: WebAssembly.Instance | undefined | null;
export const WavetableWasmInstance = new AsyncOnce(() =>
  WavetableWasmBytes.get().then(async wasmBytes => {
    const mod = await WebAssembly.compile(wasmBytes);
    const inst = await WebAssembly.instantiate(mod);
    wavetableWasmInstance = inst;
    return inst;
  })
);

const getWavetableWasmBytes = () => WavetableWasmBytes.get();

export const getWavetableWasmInstance = () => WavetableWasmInstance.get();

export const getWavetableWasmInstancePreloaded = () => {
  if (!wavetableWasmInstance) {
    throw new UnreachableError('Tried to access wavetable Wasm instance before it was loaded');
  }
  return wavetableWasmInstance;
};

export default class WaveTable implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string;
  public workletHandle: AudioWorkletNode | undefined;
  private wavetableDef: WavetableDef = getDefaultWavetableDef();
  private onInitialized?: (inst: WaveTable) => void;

  static typeName = 'Wave Table Synthesizer';
  public nodeType = 'customAudio/wavetable';
  public static manuallyCreatable = false;

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    if (params?.wavetableDef) {
      this.wavetableDef = params.wavetableDef;
    }

    if (params?.onInitialized) {
      this.onInitialized = params.onInitialized;
    }

    this.initWorklet().then(workletHandle => {
      this.paramOverrides = this.buildParamOverrides(workletHandle);

      if (params) {
        this.deserialize(params);
      }

      if (this.vcId.length > 0) {
        updateConnectables(this.vcId, this.buildConnectables());
      }

      if (this.onInitialized) {
        this.onInitialized(this);
      }
    });

    if (this.vcId) {
      this.renderSmallView = mkSvelteContainerRenderHelper({
        Comp: WaveTableSmallView,
        getProps: () => ({}),
      });

      this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });
    }
  }

  private buildParamOverrides(workletHandle: AudioWorkletNode): ForeignNode['paramOverrides'] {
    // Work around incomplete TypeScript typings
    const frequencyParam = (workletHandle.parameters as Map<string, AudioParam>).get('frequency')!;
    const frequencyOverride = new OverridableAudioParam(this.ctx, frequencyParam);
    const detuneParam = (workletHandle.parameters as Map<string, AudioParam>).get('detune');
    const detuneOverride = new OverridableAudioParam(this.ctx, detuneParam, undefined, false);

    const overrides: ForeignNode['paramOverrides'] = {
      frequency: { param: frequencyOverride, override: frequencyOverride.manualControl },
      detune: { param: detuneOverride, override: detuneOverride.manualControl },
    };

    // TODO: get dimension count dynamically
    R.range(0, 2).forEach(i => {
      const intraDimensionalMixKey = `dimension_${i}_mix`;
      // Work around incomplete TypeScript typings
      const param: AudioParam = (workletHandle.parameters as Map<string, AudioParam>).get(
        intraDimensionalMixKey
      )!;
      const override = new OverridableAudioParam(this.ctx, param);

      overrides[intraDimensionalMixKey] = {
        param: override,
        override: override.manualControl,
      };

      if (i > 0) {
        const interDimensionalMixKey = `dimension_${i - 1}x${i}_mix`;
        // Work around incomplete TypeScript typings
        const param = (workletHandle.parameters as Map<string, AudioParam>).get(
          interDimensionalMixKey
        )!;
        const override = new OverridableAudioParam(this.ctx, param);

        overrides[interDimensionalMixKey] = {
          param: override,
          override: override.manualControl,
        };
      }
    });

    return overrides;
  }

  private deserialize(params: { [key: string]: any }) {
    Object.entries(params).forEach(([key, val]) => {
      if (this.paramOverrides[key]) {
        this.paramOverrides[key].override.offset.value = val;
      }
    });

    if (params.intraDimMixes) {
      (params.intraDimMixes as number[]).forEach((mix, dimIx) => {
        this.paramOverrides[`dimension_${dimIx}_mix`].override.offset.setValueAtTime(
          mix,
          this.ctx.currentTime
        );
      });
    }

    if (params.interDimMixes) {
      (params.interDimMixes as number[]).forEach((mix, i) => {
        this.paramOverrides[`dimension_${i}x${i + 1}_mix`].override.offset.setValueAtTime(
          mix,
          this.ctx.currentTime
        );
      });
    }
  }

  public serialize() {
    return Object.entries(this.paramOverrides).reduce(
      (acc, [key, val]) => ({ ...acc, [key]: val.override.offset.value }),
      {} as { [key: string]: number }
    );
  }

  private encodeTableDef() {
    const dimensionCount = this.wavetableDef.length;
    const waveformsPerDimension = this.wavetableDef[0].length;
    const waveformLength = this.wavetableDef[0][0].length;
    const samplesPerDimension = waveformLength * waveformsPerDimension;

    const tableSamples = new Float32Array(dimensionCount * waveformsPerDimension * waveformLength);
    for (let dimensionIx = 0; dimensionIx < dimensionCount; dimensionIx++) {
      for (let waveformIx = 0; waveformIx < waveformsPerDimension; waveformIx++) {
        for (let sampleIx = 0; sampleIx < waveformLength; sampleIx++) {
          tableSamples[samplesPerDimension * dimensionIx + waveformLength * waveformIx + sampleIx] =
            this.wavetableDef[dimensionIx][waveformIx][sampleIx];
        }
      }
    }

    return { dimensionCount, waveformsPerDimension, tableSamples, waveformLength };
  }

  private async initWaveTable() {
    const { dimensionCount, waveformsPerDimension, tableSamples, waveformLength } =
      this.encodeTableDef();

    this.workletHandle!.port.postMessage({
      type: 'init',
      arrayBuffer: await getWavetableWasmBytes(),
      waveformsPerDimension,
      dimensionCount,
      waveformLength,
      baseFrequency,
      tableSamples,
    });
  }

  private async initWorklet() {
    await this.ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'WaveTableNodeProcessor.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    );
    this.workletHandle = new AudioWorkletNode(this.ctx, 'wavetable-node-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });

    await this.initWaveTable();

    return this.workletHandle;
  }

  public setWavetableDef(wavetableDef: WavetableDef, baseFrequency: number) {
    this.wavetableDef = wavetableDef;
    if (!this.workletHandle) {
      return;
    }

    const { dimensionCount, waveformsPerDimension, tableSamples, waveformLength } =
      this.encodeTableDef();
    this.workletHandle.port.postMessage({
      type: 'update',
      waveformsPerDimension,
      dimensionCount,
      waveformLength,
      baseFrequency,
      tableSamples,
    });
  }

  public buildConnectables() {
    return {
      // TODO: get dimension count dynamically
      inputs: R.range(0, 2).reduce(
        (acc, i) => {
          const newAcc = acc.set(`dimension_${i}_mix`, {
            node: this.workletHandle
              ? (this.workletHandle.parameters as any).get(`dimension_${i}_mix`)
              : new DummyNode(),
            type: 'number',
          });

          // The first dimension doesn't have any inter-dimensional mix param since it's the first one
          if (i === 0) {
            return newAcc;
          }

          return newAcc.set(`dimension_${i - 1}x${i}_mix`, {
            node: this.workletHandle
              ? (this.workletHandle.parameters as any).get(`dimension_${i - 1}x${i}_mix`)
              : new DummyNode(),
            type: 'number',
          });
        },
        Map<string, ConnectableInput>()
          .set('frequency', {
            node: this.paramOverrides.frequency
              ? this.paramOverrides.frequency.param
              : new DummyNode(),
            type: 'number',
          })
          .set('detune', {
            node: this.paramOverrides.detune ? this.paramOverrides.detune.param : new DummyNode(),
            type: 'number',
          })
      ),
      outputs: Map<string, ConnectableOutput>().set('output', {
        node: this.workletHandle ? this.workletHandle : new DummyNode(),
        type: 'customAudio',
      }),
      vcId: this.vcId,
      node: this,
    };
  }

  public shutdown() {
    this.workletHandle?.port.postMessage('shutdown');
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
