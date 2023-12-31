import type { FilterType } from 'src/synthDesigner/FilterType';

export const buildDefaultFilter = (
  type: FilterType.Lowpass | FilterType.Highpass | FilterType.Bandpass,
  Q: number,
  frequency?: number
) => ({
  type,
  frequency: frequency ?? 440,
  detune: 0,
  gain: 0,
  Q,
});
