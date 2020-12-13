import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { ADSRValues } from 'src/controls/adsr';
import { getReduxInfra } from 'src/synthDesigner';
import { getSettingsForFilterType } from 'src/synthDesigner/filterHelpers';

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
      className='filter-control-panel'
      style={{ width: 400 }}
      title='FILTER'
      settings={settings}
      state={state}
      onChange={(key: string, val: any) => {
        if (key === 'adsr') {
          dispatch(actionCreators.synthDesigner.SET_FILTER_ADSR(val, synthIx));
          return;
        } else if (key === 'bypass') {
          dispatch(actionCreators.synthDesigner.SET_FILTER_IS_BYPASSED(synthIx, val));
        } else if (key === 'adsr length ms') {
          dispatch(actionCreators.synthDesigner.SET_FILTER_ADSR_LENGTH(synthIx, val));
        }

        dispatch(actionCreators.synthDesigner.SET_FILTER_PARAM(synthIx, key as any, val));
      }}
    />
  );
};

export default Filter;
