import * as R from 'ramda';
import React, { useCallback } from 'react';
import { Range } from 'react-control-panel';

import type { AudioThreadData } from 'src/controls/adsr2/adsr2';
import { buildDefaultADSR2Envelope } from 'src/controls/adsr2/adsr2Helpers';
import { mkControlPanelADSR2WithSize } from 'src/controls/adsr2/ControlPanelADSR2';
import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { FilterType } from 'src/synthDesigner/FilterType';
import { clamp, dbToLinear, filterNils, linearToDb } from 'src/util';

/**
 * @returns `true` if the filter type is a primitive filter type (one which is natively supported by WebAudio's
 *          `BiquadFilterNode`), `false` otherwise.
 */
export const isFilterTypePrimitive = (filterType: FilterType) => {
  switch (filterType) {
    case FilterType.Lowpass:
    case FilterType.Highpass:
    case FilterType.Bandpass:
    case FilterType.Lowshelf:
    case FilterType.Highshelf:
    case FilterType.Peaking:
    case FilterType.Notch:
    case FilterType.Allpass:
      return true;
    default:
      return false;
  }
};

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
  let linearQ = clamp(0.3, 30, dbToLinear(value));
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
      steps={800}
      min={0.3}
      max={30}
      scale='log'
    />
  );
};

const LINEAR_Q_FILTER_TYPES = [
  FilterType.Bandpass,
  FilterType.BP4,
  FilterType.BP8,
  FilterType.BP16,
  FilterType.Allpass,
  FilterType.Peaking,
  FilterType.Notch,
];

/**
 * Some filter types (bandpass, allpass, peaking, and notch) interpret Q as a linear value with a minimum of
 * 0 instead of a dB value.
 *
 * We still store Q as a dB value internally, but we want to render the scale as linear with a minimum of 0.
 */
const CustomLinearQSetting: React.FC<CustomQSettingProps> = ({ value, onChange }) => {
  if (R.isNil(value)) {
    console.error('Nil `Q` value but Q control panel setting rendered; reseting to default...');
    value = 1;
  }
  const wrappedOnChange = useCallback((newQ: number) => onChange(linearToDb(newQ)), [onChange]);

  return (
    <Range
      label='Q'
      onChange={wrappedOnChange}
      value={dbToLinear(value)}
      steps={800}
      scale='log'
      min={0.001}
      max={15}
    />
  );
};

const buildFilterSettings = (
  filterType: FilterType,
  includeADSR: boolean,
  adsrDebugName?: string,
  adsrAudioThreadData?: AudioThreadData,
  includeNonPrimitiveFilterTypes?: boolean
) => ({
  bypass: {
    label: 'bypass',
    type: 'checkbox',
    initial: true,
  },
  type: {
    type: 'select',
    label: 'type',
    options: includeNonPrimitiveFilterTypes
      ? Object.values(FilterType)
      : Object.values(FilterType).filter(isFilterTypePrimitive),
    initial: FilterType.Lowpass,
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
    Comp: LINEAR_Q_FILTER_TYPES.includes(filterType)
      ? React.memo(CustomLinearQSetting)
      : React.memo(CustomQSetting),
    renderContainer: false,
    initial: 1,
    steps: 1000,
  },
  adsr: includeADSR
    ? {
        type: 'custom',
        label: 'adsr',
        initial: {
          ...buildDefaultADSR2Envelope(
            adsrAudioThreadData ?? { phaseIndex: 0, debugName: 'buildFilterSettings' }
          ),
          outputRange: [0, 20_000],
          logScale: true,
        },
        Comp: mkControlPanelADSR2WithSize(500, 320, undefined, adsrDebugName),
      }
    : { label: 'adsr' },
});

interface GetSettingsForFilterTypeArgs {
  filterType: FilterType;
  includeADSR: false | { adsrAudioThreadData?: AudioThreadData };
  includeBypass?: boolean;
  vcId?: string;
  adsrDebugName?: string;
  includeNonPrimitiveFilterTypes?: boolean;
}

export const getSettingsForFilterType = ({
  filterType,
  includeADSR,
  includeBypass = true,
  vcId,
  adsrDebugName,
  includeNonPrimitiveFilterTypes = true,
}: GetSettingsForFilterTypeArgs) => {
  const filterSettings = buildFilterSettings(
    filterType,
    !!includeADSR,
    adsrDebugName,
    undefined,
    includeNonPrimitiveFilterTypes
  );
  return R.clone(
    filterNils([
      includeBypass ? filterSettings.bypass : null,
      filterSettings.type,
      filterSettings.frequency,
      ...(() => {
        switch (filterType) {
          case FilterType.Lowshelf:
          case FilterType.Highshelf: {
            return [filterSettings.gain];
          }
          case FilterType.Peaking: {
            return [filterSettings.gain, filterSettings.q];
          }
          case FilterType.DynaBP_50:
          case FilterType.DynaBP_100:
          case FilterType.DynaBP_200:
          case FilterType.DynaBP_400:
          case FilterType.DynaBP_800:
            return [];
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
  getSettingsForFilterType({
    filterType,
    includeADSR: false,
    includeBypass: false,
    vcId: undefined,
    adsrDebugName: 'getDefaultFilterParams SHOULD NOT SHOW UP',
  }).reduce((acc, { label, initial }) => ({ ...acc, [label]: initial }), {}) as FilterParams;
