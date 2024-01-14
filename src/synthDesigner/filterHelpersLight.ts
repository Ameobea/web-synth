import type { FilterParams } from 'src/redux/modules/synthDesigner';
import type { FilterType } from 'src/synthDesigner/FilterType';

export const buildDefaultFilter = (
  type: FilterType.Lowpass | FilterType.Highpass | FilterType.Bandpass,
  Q: number,
  frequency = 440
): FilterParams => ({
  type,
  frequency,
  gain: 0,
  Q,
});
