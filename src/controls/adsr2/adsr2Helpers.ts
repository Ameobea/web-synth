import type { AudioThreadData } from 'src/controls/adsr2/adsr2';
import type { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth';
import { SAMPLE_RATE } from 'src/util';

export const buildDefaultADSR2Envelope = (audioThreadData: AudioThreadData): Adsr => ({
  steps: [
    { x: 0, y: 0.2, ramper: { type: 'exponential', exponent: 0.5 } },
    { x: 0.5, y: 0.8, ramper: { type: 'exponential', exponent: 0.5 } },
    { x: 1, y: 0.2, ramper: { type: 'exponential', exponent: 0.5 } },
  ],
  lenSamples: SAMPLE_RATE / 4,
  loopPoint: 0,
  releasePoint: 0.7,
  audioThreadData,
  logScale: true,
});
