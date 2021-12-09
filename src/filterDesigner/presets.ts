import type { SerializedFilterDesigner } from 'src/filterDesigner/util';
import { computeHigherOrderBiquadQFactors } from 'src/synthDesigner/biquadFilterModule';
import { buildDefaultFilter, FilterType } from 'src/synthDesigner/filterHelpers';

interface FilterDesignerPreset {
  name: string;
  preset: SerializedFilterDesigner;
}

const Presets: FilterDesignerPreset[] = [
  {
    name: 'init',
    preset: {
      filterGroups: [
        [buildDefaultFilter(FilterType.Lowpass, computeHigherOrderBiquadQFactors(2)[0])],
      ],
      lockedFrequencyByGroup: [null],
    },
  },
  {
    name: 'order 4 LP',
    preset: {
      filterGroups: [
        computeHigherOrderBiquadQFactors(4).map(q => buildDefaultFilter(FilterType.Lowpass, q)),
      ],
      lockedFrequencyByGroup: [440],
    },
  },
  {
    name: 'order 8 LP',
    preset: {
      filterGroups: [
        computeHigherOrderBiquadQFactors(8).map(q => buildDefaultFilter(FilterType.Lowpass, q)),
      ],
      lockedFrequencyByGroup: [440],
    },
  },
  {
    name: 'order 16 LP',
    preset: {
      filterGroups: [
        computeHigherOrderBiquadQFactors(16).map(q => buildDefaultFilter(FilterType.Lowpass, q)),
      ],
      lockedFrequencyByGroup: [440],
    },
  },
  {
    name: 'order 4 HP',
    preset: {
      filterGroups: [
        computeHigherOrderBiquadQFactors(4).map(q => buildDefaultFilter(FilterType.Highpass, q)),
      ],
      lockedFrequencyByGroup: [440],
    },
  },
  {
    name: 'order 8 HP',
    preset: {
      filterGroups: [
        computeHigherOrderBiquadQFactors(8).map(q => buildDefaultFilter(FilterType.Highpass, q)),
      ],
      lockedFrequencyByGroup: [440],
    },
  },
  {
    name: 'order 16 HP',
    preset: {
      filterGroups: [
        computeHigherOrderBiquadQFactors(16).map(q => buildDefaultFilter(FilterType.Highpass, q)),
      ],
      lockedFrequencyByGroup: [440],
    },
  },
  {
    name: 'band splitter',
    preset: (() => {
      const lowBandCutoff = 400;
      const midBandCutoff = 4000;

      const lowBand = computeHigherOrderBiquadQFactors(16).map(q =>
        buildDefaultFilter(FilterType.Lowpass, q, lowBandCutoff)
      );
      const midBandBottom = computeHigherOrderBiquadQFactors(16).map(q =>
        buildDefaultFilter(FilterType.Highpass, q, lowBandCutoff + 32)
      );
      const midBandTop = computeHigherOrderBiquadQFactors(16).map(q =>
        buildDefaultFilter(FilterType.Lowpass, q, midBandCutoff - 284.8)
      );
      const highBand = computeHigherOrderBiquadQFactors(16).map(q =>
        buildDefaultFilter(FilterType.Highpass, q, midBandCutoff)
      );

      return {
        filterGroups: [lowBand, [...midBandBottom, ...midBandTop], highBand],
        lockedFrequencyByGroup: [400, null, 4000],
      };
    })(),
  },
];

export default Presets;
