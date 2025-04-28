import { EQ_Q_DOMAIN, EQ_GAIN_DOMAIN } from 'src/equalizer/conf';

export enum EqualizerFilterType {
  Lowpass = 0,
  Highpass = 1,
  Bandpass = 2,
  Notch = 3,
  Peak = 4,
  Lowshelf = 5,
  Highshelf = 6,
  Allpass = 7,
}

export const getValidParamsForFilterType = (
  filterType: EqualizerFilterType
): ('freq' | 'gain' | 'q')[] => {
  switch (filterType) {
    case EqualizerFilterType.Lowpass:
    case EqualizerFilterType.Highpass:
    case EqualizerFilterType.Bandpass:
    case EqualizerFilterType.Notch:
    case EqualizerFilterType.Allpass:
      return ['freq', 'q'];
    case EqualizerFilterType.Peak:
      return ['freq', 'gain', 'q'];
    case EqualizerFilterType.Lowshelf:
    case EqualizerFilterType.Highshelf:
      return ['freq', 'gain'];
    default:
      filterType satisfies never;
      throw new Error(`Unknown filter type: ${filterType}`);
  }
};

export const getEqAxes = (
  filterType: EqualizerFilterType
): { yParam: 'gain' | 'q'; yDomain: [number, number] } & (
  | { scrollParam: 'q'; scrollDomain: [number, number] }
  | { scrollParam: null; scrollDomain: null }
) => {
  switch (filterType) {
    case EqualizerFilterType.Peak:
      return {
        yParam: 'gain' as const,
        yDomain: EQ_GAIN_DOMAIN,
        scrollParam: 'q' as const,
        scrollDomain: EQ_Q_DOMAIN,
      };
    case EqualizerFilterType.Lowshelf:
    case EqualizerFilterType.Highshelf:
      return {
        yParam: 'gain' as const,
        yDomain: EQ_GAIN_DOMAIN,
        scrollParam: null,
        scrollDomain: null,
      };
    case EqualizerFilterType.Highpass:
    case EqualizerFilterType.Lowpass:
    case EqualizerFilterType.Bandpass:
    case EqualizerFilterType.Notch:
    case EqualizerFilterType.Allpass:
      return {
        yParam: 'q' as const,
        yDomain: EQ_Q_DOMAIN,
        scrollParam: null,
        scrollDomain: null,
      };
    default:
      filterType satisfies never;
      throw new Error(`Unknown filter type: ${filterType}`);
  }
};
