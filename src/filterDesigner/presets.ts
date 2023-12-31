import { buildHighOrderBandpassFilters } from 'src/filterDesigner/higherOrderBandpass';
import type { SerializedFilterDesigner } from 'src/filterDesigner/util';
import { buildVocoderBandpassChainPreset } from 'src/filterDesigner/vocoder';
import { FilterType } from 'src/synthDesigner/FilterType';
import { computeHigherOrderBiquadQFactors } from 'src/synthDesigner/biquadFilterModule';
import { buildDefaultFilter } from 'src/synthDesigner/filterHelpersLight';

export interface FilterDesignerPreset {
  name: string;
  preset: SerializedFilterDesigner;
}

export const buildBandSplitterPreset = () => {
  const lowBandCutoff = 400;
  const midBandCutoff = 3000;

  const lowBand = computeHigherOrderBiquadQFactors(16).map(q =>
    buildDefaultFilter(FilterType.Lowpass, q, lowBandCutoff)
  );
  const midBandBottom = computeHigherOrderBiquadQFactors(16).map(q =>
    buildDefaultFilter(FilterType.Highpass, q, lowBandCutoff + 32)
  );
  const midBandTop = computeHigherOrderBiquadQFactors(16).map(q =>
    buildDefaultFilter(FilterType.Lowpass, q, midBandCutoff - 214.8)
  );
  const highBand = computeHigherOrderBiquadQFactors(16).map(q =>
    buildDefaultFilter(FilterType.Highpass, q, midBandCutoff)
  );

  return {
    filterGroups: [lowBand, [...midBandBottom, ...midBandTop], highBand],
    lockedFrequencyByGroup: [lowBandCutoff, null, midBandCutoff],
  };
};

export const buildOTTBandSplitterPreset = () => {
  const lowBandCutoff = 88.3;
  const midBandCutoff = 2500;

  const lowBand = computeHigherOrderBiquadQFactors(16).map(q =>
    buildDefaultFilter(FilterType.Lowpass, q, lowBandCutoff)
  );
  const midBandBottom = computeHigherOrderBiquadQFactors(16).map(q =>
    buildDefaultFilter(FilterType.Highpass, q, lowBandCutoff + 7.5)
  );
  const midBandTop = computeHigherOrderBiquadQFactors(16).map(q =>
    buildDefaultFilter(FilterType.Lowpass, q, midBandCutoff - 184.8)
  );
  const highBand = computeHigherOrderBiquadQFactors(16).map(q =>
    buildDefaultFilter(FilterType.Highpass, q, midBandCutoff)
  );

  return {
    filterGroups: [lowBand, [...midBandBottom, ...midBandTop], highBand],
    lockedFrequencyByGroup: [lowBandCutoff, null, midBandCutoff],
  };
};

const buildFilterDesignerPresets = (): FilterDesignerPreset[] => [
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
    name: 'order 4 BP',
    preset: {
      filterGroups: [
        computeHigherOrderBiquadQFactors(4).map(q => buildDefaultFilter(FilterType.Bandpass, q)),
      ],
      lockedFrequencyByGroup: [440],
    },
  },
  {
    name: 'order 8 BP',
    preset: {
      filterGroups: [
        computeHigherOrderBiquadQFactors(8).map(q => buildDefaultFilter(FilterType.Bandpass, q)),
      ],
      lockedFrequencyByGroup: [440],
    },
  },
  {
    name: 'order 16 BP',
    preset: {
      filterGroups: [
        computeHigherOrderBiquadQFactors(16).map(q => buildDefaultFilter(FilterType.Bandpass, q)),
      ],
      lockedFrequencyByGroup: [440],
    },
  },
  {
    name: 'order 4 composite BP 4khz bandwidth',
    preset: {
      filterGroups: [buildHighOrderBandpassFilters(4, 4000, 2200)],
      lockedFrequencyByGroup: [null],
    },
  },
  {
    name: 'order 16 composite BP 2khz bandwidth',
    preset: {
      filterGroups: [buildHighOrderBandpassFilters(16, 2000, 1050)],
      lockedFrequencyByGroup: [null],
    },
  },
  {
    name: 'order 16 composite BP 200hz bandwidth',
    preset: {
      filterGroups: [buildHighOrderBandpassFilters(16, 200, 13000)],
      lockedFrequencyByGroup: [null],
    },
  },
  {
    name: 'band splitter',
    preset: buildBandSplitterPreset(),
  },
  {
    name: 'OTT band splitter',
    preset: buildOTTBandSplitterPreset(),
  },
  {
    name: 'vocoder bandpass chain',
    preset: buildVocoderBandpassChainPreset(16),
  },
];

export default buildFilterDesignerPresets;
