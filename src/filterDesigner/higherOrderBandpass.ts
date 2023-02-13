import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { computeHigherOrderBiquadQFactors } from 'src/synthDesigner/biquadFilterModule';
import { buildDefaultFilter, FilterType } from 'src/synthDesigner/filterHelpers';

export const buildHighOrderBandpassFilters = (
  order: number,
  bandwidthHz: number,
  centerFreqHz: number
): FilterParams[] => {
  const highPassFreq = centerFreqHz - bandwidthHz / 2;
  const lowPassFreq = centerFreqHz + bandwidthHz / 2;

  const lowPasses = computeHigherOrderBiquadQFactors(order).map(q =>
    buildDefaultFilter(FilterType.Lowpass, q, lowPassFreq)
  );
  const highPasses = computeHigherOrderBiquadQFactors(order).map(q =>
    buildDefaultFilter(FilterType.Highpass, q, highPassFreq)
  );

  return [...lowPasses, ...highPasses];
};
