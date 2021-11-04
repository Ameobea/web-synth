import React, { useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import * as R from 'ramda';

import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { getReduxInfra } from 'src/synthDesigner';
import { getSettingsForFilterType } from 'src/synthDesigner/filterHelpers';
import type { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

const style = { width: 600 };

interface FilterProps {
  params: FilterParams;
  synthIx: number;
  filterEnvelope: Adsr & { outputRange: readonly [number, number] };
  bypass: boolean;
  stateKey: string;
}

const Filter: React.FC<FilterProps> = ({ params, synthIx, filterEnvelope, bypass, stateKey }) => {
  const settings = useMemo(() => getSettingsForFilterType(params.type), [params.type]);
  if (!filterEnvelope.outputRange) {
    console.error('Missing `outputRange` on `filterEnvelope` provided to `<Filter />`');
  }
  const state = useMemo(() => {
    const state = { ...params, adsr: filterEnvelope, bypass };
    if (!R.isNil(state.Q) && Number.isNaN(state.Q)) {
      console.warn('NaN Q found for filter; normalizing...');
      state.Q = 1;
    }
    return state;
  }, [params, filterEnvelope, bypass]);
  const { dispatch, actionCreators } = getReduxInfra(stateKey);
  const handleChange = useCallback(
    (key: string, val: any) => {
      if (key === 'adsr') {
        dispatch(actionCreators.synthDesigner.SET_FILTER_ADSR(val, synthIx));
        return;
      } else if (key === 'bypass') {
        dispatch(actionCreators.synthDesigner.SET_FILTER_IS_BYPASSED(synthIx, val));
      } else if (key === 'adsr length ms') {
        dispatch(actionCreators.synthDesigner.SET_FILTER_ADSR_LENGTH(synthIx, val));
      }

      dispatch(actionCreators.synthDesigner.SET_FILTER_PARAM(synthIx, key as any, val));
    },
    [actionCreators.synthDesigner, dispatch, synthIx]
  );

  return (
    <ControlPanel
      className='filter-control-panel'
      style={style}
      title='FILTER'
      settings={settings}
      state={state}
      onChange={handleChange}
    />
  );
};

export default Filter;
