import React, { useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import type { ADSRValues } from 'src/controls/adsr';
import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { ADSRModule } from 'src/synthDesigner/ADSRModule';
import { getSettingsForFilterType } from 'src/synthDesigner/filterHelpers';

const setFilter = (
  filters: BiquadFilterNode[],
  key: 'frequency' | 'detune' | 'gain' | 'Q',
  val: number
) =>
  filters.forEach(filter => {
    filter[key].value = val;
  });

const handleFilterChange = (
  filters: BiquadFilterNode[],
  adsrs: ADSRModule[],
  state: { params: FilterParams; envelope: ADSRValues; bypass: boolean; envelopeLenMs: number },
  key: string,
  val: any
) => {
  const newState = { ...state, params: { ...state.params } };
  switch (key) {
    case 'frequency': {
      setFilter(filters, 'frequency', val);
      newState.params.frequency = val;
      break;
    }
    case 'detune': {
      setFilter(filters, 'detune', val);
      newState.params.detune = val;
      break;
    }
    case 'type': {
      filters.forEach(filter => {
        filter.type = val;
      });
      newState.params.type = val;
      break;
    }
    case 'Q': {
      setFilter(filters, 'Q', val);
      newState.params.Q = val;
      break;
    }
    case 'gain': {
      setFilter(filters, 'gain', val);
      newState.params.gain = val;
      break;
    }
    case 'adsr length ms': {
      adsrs.forEach(adsr => adsr.setLengthMs(val));
      newState.envelopeLenMs = val;
      break;
    }
    case 'adsr': {
      adsrs.forEach(adsr => adsr.setEnvelope(val));
      newState.envelope = val;
      break;
    }
    case 'bypass': {
      newState.bypass = val;
      break;
    }
    default: {
      console.error('Unhandled key in filter config: ', key);
    }
  }
  return newState;
};

const FilterConfig: React.FC<{
  initialState: {
    params: FilterParams;
    envelope: ADSRValues;
    bypass: boolean;
    envelopeLenMs: number;
  };
  filters: BiquadFilterNode[];
  adsrs: ADSRModule[];
  onChange: (
    params: FilterParams,
    envelope: ADSRValues,
    bypass: boolean,
    envelopeLenMs: number
  ) => void;
}> = ({ initialState, filters, adsrs, onChange }) => {
  const [state, setState] = useState(initialState);

  const settings = useMemo(() => getSettingsForFilterType(state.params.type), [state.params.type]);
  const controlPanelState = useMemo(
    () => ({
      ...state.params,
      adsr: state.envelope,
      bypass: state.bypass,
      'adsr length ms': state.envelopeLenMs,
    }),
    [state.bypass, state.envelope, state.envelopeLenMs, state.params]
  );

  return (
    <ControlPanel
      className='filter-control-panel'
      style={{ width: 400 }}
      title='FILTER'
      settings={settings}
      state={controlPanelState}
      onChange={(key: string, val: any) => {
        const newState = handleFilterChange(filters, adsrs, state, key, val);
        onChange(newState.params, newState.envelope, newState.bypass, newState.envelopeLenMs);
        setState(newState);
      }}
    />
  );
};

export default FilterConfig;
