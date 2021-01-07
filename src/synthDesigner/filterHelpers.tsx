import { filterNils } from 'ameo-utils';
import * as R from 'ramda';

import { defaultAdsrEnvelope, ControlPanelADSR } from 'src/controls/adsr';
import type { FilterParams } from 'src/redux/modules/synthDesigner';

export enum FilterType {
  Lowpass = 'lowpass',
  Highpass = 'highpass',
  Bandpass = 'bandpass',
  Lowshelf = 'lowshelf',
  Highshelf = 'highshelf',
  Peaking = 'peaking',
  Notch = 'notch',
  Allpass = 'allpass',
}

const filterSettings = {
  bypass: {
    label: 'bypass',
    type: 'checkbox',
    initial: true,
  },
  type: {
    type: 'select',
    label: 'type',
    options: Object.values(FilterType),
    initial: FilterType.Lowpass,
  },
  detune: {
    type: 'range',
    label: 'detune',
    min: -200,
    max: 200,
    initial: 0,
    stepSize: 5,
  },
  frequency: {
    type: 'range',
    label: 'frequency',
    min: 80,
    max: 24000,
    initial: 4400,
    scale: 'log',
    steps: 250,
  },
  gain: {
    type: 'range',
    label: 'gain',
    min: -20,
    max: 40,
    step: 0.2,
    initial: 0,
  },
  q: {
    type: 'range',
    label: 'Q',
    min: 0.001,
    max: 100,
    initial: 0.001,
    steps: 100,
    scale: 'log',
  },
  adsr: {
    type: 'custom',
    label: 'adsr',
    initial: defaultAdsrEnvelope,
    Comp: ControlPanelADSR,
  },
};

export const getSettingsForFilterType = (filterType: FilterType, includeADSR = true) =>
  R.clone(
    filterNils([
      filterSettings.bypass,
      filterSettings.type,
      filterSettings.frequency,
      filterSettings.detune,
      ...{
        [FilterType.Lowpass]: [filterSettings.q],
        [FilterType.Highpass]: [filterSettings.q],
        [FilterType.Bandpass]: [filterSettings.q],
        [FilterType.Lowshelf]: [filterSettings.gain],
        [FilterType.Highshelf]: [filterSettings.gain],
        [FilterType.Peaking]: [filterSettings.gain, filterSettings.q],
        [FilterType.Notch]: [filterSettings.q],
        [FilterType.Allpass]: [filterSettings.q],
      }[filterType],
      includeADSR
        ? {
            type: 'range',
            label: 'adsr length ms',
            min: 50,
            max: 10000,
            initial: 1000,
          }
        : null,
      includeADSR ? filterSettings.adsr : null,
    ])
  );

export const getDefaultFilterParams = (filterType: FilterType): FilterParams =>
  getSettingsForFilterType(filterType).reduce(
    (acc, { label, initial }) => ({ ...acc, [label]: initial }),
    {}
  ) as FilterParams;
