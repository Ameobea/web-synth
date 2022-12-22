import { filterNils } from 'ameo-utils';
import * as R from 'ramda';
import React, { useCallback } from 'react';
import { Range } from 'react-control-panel';

import { buildDefaultADSR2Envelope, type AudioThreadData } from 'src/controls/adsr2/adsr2';
import { mkControlPanelADSR2WithSize } from 'src/controls/adsr2/ControlPanelADSR2';
import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { dbToLinear, linearToDb } from 'src/util';

export enum FilterType {
  Lowpass = 'lowpass',
  LP4 = 'order 4 lowpass',
  LP8 = 'order 8 lowpass',
  LP16 = 'order 16 lowpass',
  Highpass = 'highpass',
  HP4 = 'order 4 highpass',
  HP8 = 'order 8 highpass',
  HP16 = 'order 16 highpass',
  Bandpass = 'bandpass',
  Lowshelf = 'lowshelf',
  Highshelf = 'highshelf',
  Peaking = 'peaking',
  Notch = 'notch',
  Allpass = 'allpass',
}

interface CustomQSettingProps {
  value: number;
  onChange: (newVal: number) => void;
}

/**
 * Converts values between linear and dB.  Most places have their Q values in linear units starting at 0, but WebAudio
 * uses Q factors in dB.  So we display the value in linear units starting at 0 and convert them transparently
 * to dB behind the scenes.
 */
const CustomQSetting: React.FC<CustomQSettingProps> = ({ value, onChange }) => {
  if (R.isNil(value)) {
    console.error('Nil `Q` value but Q control panel setting rendered; reseting to default...');
    value = 1;
  }
  let linearQ = dbToLinear(value);
  if (Number.isNaN(linearQ)) {
    console.error('NaN `Q` value after converting from log to linear; logQ=' + value);
    linearQ = 1;
  }
  const wrappedOnChange = useCallback((newQ: number) => onChange(linearToDb(newQ)), [onChange]);

  return (
    <Range
      label='Q'
      onChange={wrappedOnChange}
      value={linearQ}
      min={0.01}
      max={30}
      steps={300}
      scale='log'
    />
  );
};

const buildFilterSettings = (adsrDebugName?: string, adsrAudioThreadData?: AudioThreadData) => ({
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
    step: 1,
  },
  frequency: {
    type: 'range',
    label: 'frequency',
    min: 10,
    max: 22050,
    initial: 4400,
    scale: 'log',
    steps: 1000,
  },
  gain: {
    type: 'range',
    label: 'gain',
    min: -20,
    max: 40,
    step: 0.01,
    initial: 0,
  },
  q: {
    type: 'custom',
    label: 'Q',
    Comp: React.memo(CustomQSetting),
    renderContainer: false,
    initial: 1,
    steps: 1000,
  },
  adsr: {
    type: 'custom',
    label: 'adsr',
    initial: {
      ...buildDefaultADSR2Envelope(
        adsrAudioThreadData ?? { phaseIndex: 0, debugName: 'buildFilterSettings' }
      ),
      outputRange: [0, 20_000],
    },
    Comp: mkControlPanelADSR2WithSize(500, 320, undefined, adsrDebugName),
  },
});

export const getSettingsForFilterType = (
  filterType: FilterType,
  includeADSR: false | { adsrAudioThreadData?: AudioThreadData },
  includeBypass = true,
  vcId?: string,
  adsrDebugName?: string
) => {
  const filterSettings = buildFilterSettings(adsrDebugName);
  return R.clone(
    filterNils([
      includeBypass ? filterSettings.bypass : null,
      filterSettings.type,
      filterSettings.frequency,
      filterSettings.detune,
      ...(() => {
        switch (filterType) {
          case FilterType.Lowshelf:
          case FilterType.Highshelf: {
            return [filterSettings.gain];
          }
          case FilterType.Peaking: {
            return [filterSettings.gain, filterSettings.q];
          }
          default: {
            return [filterSettings.q];
          }
        }
      })(),
      includeADSR ? { type: 'checkbox', label: 'enable envelope', initial: true } : null,
      includeADSR
        ? {
            type: 'range',
            label: 'adsr length ms',
            min: 20,
            max: 10000,
            initial: 1000,
            scale: 'log',
          }
        : null,
      includeADSR
        ? {
            ...filterSettings.adsr,
            Comp: mkControlPanelADSR2WithSize(500, 320, vcId, adsrDebugName),
          }
        : null,
    ])
  );
};

export const getDefaultFilterParams = (filterType: FilterType): FilterParams =>
  getSettingsForFilterType(
    filterType,
    false,
    false,
    undefined,
    'getDefaultFilterParams SHOULD NOT SHOW UP'
  ).reduce((acc, { label, initial }) => ({ ...acc, [label]: initial }), {}) as FilterParams;

export const buildDefaultFilter = (
  type: FilterType.Lowpass | FilterType.Highpass,
  Q: number,
  frequency?: number
) => ({
  type,
  frequency: frequency ?? 440,
  detune: 0,
  gain: 0,
  Q,
});
