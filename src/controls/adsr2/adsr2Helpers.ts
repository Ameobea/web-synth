import type { AudioThreadData } from 'src/controls/adsr2/adsr2';
import type { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth';
import { SAMPLE_RATE } from 'src/util';

export const buildDefaultADSR2Envelope = (audioThreadData: AudioThreadData): Adsr => ({
  steps: [
    { ramper: { type: 'instant' as const }, x: 0, y: 0.9 },
    {
      x: 0.8,
      y: 0.45,
      ramper: {
        type: 'bezier' as const,
        controlPoints: [
          { x: 0.3, y: 0.6 },
          { x: 0.3, y: 0.6 },
        ],
      },
    },
    {
      x: 1,
      y: 0,
      ramper: {
        type: 'bezier' as const,
        controlPoints: [
          { x: 0.2, y: 0.2 },
          { x: 0.2, y: 0.2 },
        ],
      },
    },
  ],
  lenSamples: SAMPLE_RATE / 4,
  loopPoint: 0,
  releasePoint: 0.8,
  audioThreadData,
  logScale: true,
});
