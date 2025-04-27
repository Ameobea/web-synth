import { EqualizerFilterType } from 'src/equalizer/equalizer';

export const getValidParamsForFilterType = (
  filterType: EqualizerFilterType
): ('freq' | 'gain' | 'q')[] => {
  switch (filterType) {
    case EqualizerFilterType.Allpass:
    case EqualizerFilterType.Bandpass:
    case EqualizerFilterType.Peak:
    case EqualizerFilterType.Notch:
      return ['freq', 'gain', 'q'];
    case EqualizerFilterType.Lowpass:
    case EqualizerFilterType.Highpass:
    case EqualizerFilterType.Lowshelf:
    case EqualizerFilterType.Highshelf:
      return ['freq', 'gain'];
    default:
      filterType satisfies never;
      throw new Error(`Unknown filter type: ${filterType}`);
  }
};
