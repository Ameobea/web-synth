import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import { FilterParams, getSettingsForFilterType } from 'src/redux/modules/synthDesigner';
import { dispatch, actionCreators } from 'src/redux';

const Filter: React.FC<{ params: FilterParams; synthIx: number }> = ({ params, synthIx }) => {
  const settings = useMemo(() => getSettingsForFilterType(params.type), [params.type]);

  return (
    <div className='filter-module'>
      <ControlPanel
        title='FILTER'
        settings={settings}
        state={params}
        onChange={(key: keyof FilterParams, val: any) => {
          dispatch(actionCreators.synthDesigner.SET_FILTER_PARAM(synthIx, key, val));
        }}
      />
    </div>
  );
};

export default Filter;
