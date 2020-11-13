import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import { FilterParams, getSettingsForFilterType } from 'src/redux/modules/synthDesigner';
import { ADSRValues } from 'src/controls/adsr';
import { getReduxInfra } from 'src/synthDesigner';

const Filter: React.FC<{
  params: FilterParams;
  synthIx: number;
  filterEnvelope: ADSRValues;
  bypass: boolean;
  stateKey: string;
}> = ({ params, synthIx, filterEnvelope, bypass, stateKey }) => {
  const settings = useMemo(() => getSettingsForFilterType(params.type), [params.type]);
  const state = useMemo(() => ({ ...params, adsr: filterEnvelope, bypass }), [
    params,
    filterEnvelope,
    bypass,
  ]);
  const { dispatch, actionCreators } = getReduxInfra(stateKey);

  return (
    <ControlPanel
      style={{ width: 400 }}
      title='FILTER'
      settings={settings}
      state={state}
      onChange={(key: keyof typeof state, val: any) => {
        if (key === 'adsr') {
          dispatch(actionCreators.synthDesigner.SET_FILTER_ADSR(val, synthIx));
          return;
        } else if (key === 'bypass') {
          dispatch(actionCreators.synthDesigner.SET_FILTER_IS_BYPASSED(synthIx, val));
        }

        dispatch(actionCreators.synthDesigner.SET_FILTER_PARAM(synthIx, key, val));
      }}
    />
  );
};

export default Filter;
