import { Map } from 'immutable';
import * as R from 'ramda';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import {
  ConnectableInput,
  ConnectableOutput,
  create_empty_audio_connectables,
  updateConnectables,
} from 'src/patchNetwork';

// Manually generate some waveforms... for science

const SAMPLE_RATE = 44100;
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

// print the generated waveforms to CSV for debugging purposes
let buf = 'sine,triangle,square,sawtooth\n';

for (let rowIx = 0; rowIx < waveformLength; rowIx++) {
  for (let waveformIx = 0; waveformIx < bufs.length; waveformIx++) {
    buf += `${bufs[waveformIx][rowIx]}`;
    if (waveformIx !== bufs.length - 1) {
      buf += ',';
    } else {
      buf += '\n';
    }
  }
}

console.log(buf);

export default class WaveTable implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string;
  private workletHandle: AudioWorkletNode | undefined;

  public name = 'Wave Table Synthesizer';
  public nodeType = 'customAudio/wavetable';

  public paramOverrides = {}; // TODO

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    if (params) {
      this.deserialize(params);
    }

    this.initWorklet();
  }

  private deserialize(params: { [key: string]: any }) {
    // TODO
  }

  public serialize() {
    return {}; // TODO
  }

  private async initWaveTable() {
    // TODO: Retrieve all of this from UI or inputs or whatever.
    const wavetableDef = [
      [bufs[0], bufs[1]],
      [bufs[2], bufs[3]],
    ];

    const dimensionCount = 2;
    const waveformsPerDimension = 2;
    const samplesPerDimension = waveformLength * waveformsPerDimension;

    const tableSamples = new Float32Array(dimensionCount * waveformsPerDimension * waveformLength);
    for (let dimensionIx = 0; dimensionIx < dimensionCount; dimensionIx++) {
      for (let waveformIx = 0; waveformIx < waveformsPerDimension; waveformIx++) {
        for (let sampleIx = 0; sampleIx < waveformLength; sampleIx++) {
          tableSamples[samplesPerDimension * dimensionIx + waveformLength * waveformIx + sampleIx] =
            wavetableDef[dimensionIx][waveformIx][sampleIx];
        }
      }
    }

    const moduleBytes = await fetch('./wavetable.wasm').then(res => res.arrayBuffer());

    this.workletHandle!.port.postMessage({
      arrayBuffer: moduleBytes,
      waveformsPerDimension,
      dimensionCount,
      waveformLength,
      baseFrequency,
      tableSamples,
    });
  }

  private async initWorklet() {
    await this.ctx.audioWorklet.addModule('/WaveTableNodeProcessor.js');
    this.workletHandle = new AudioWorkletNode(this.ctx, 'wavetable-node-processor');

    await this.initWaveTable();

    updateConnectables(this.vcId, this.buildConnectables());
  }

  public buildConnectables() {
    if (!this.workletHandle) {
      return { ...create_empty_audio_connectables(this.vcId), node: this };
    }

    return {
      // TODO: get dimension count dynamically
      inputs: R.range(0, 2).reduce(
        (acc, i) =>
          acc.set(`mix_${i}`, {
            node: (this.workletHandle!.parameters as any).get(`mix_${i}`),
            type: 'number',
          }),
        Map<string, ConnectableInput>()
      ),
      outputs: Map<string, ConnectableOutput>().set('output', {
        node: this.workletHandle,
        type: 'customAudio',
      }),
      vcId: this.vcId,
      node: this,
    };
  }
}
