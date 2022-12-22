import * as R from 'ramda';
import React, { useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import type { ADSRWithOutputRange } from 'src/controls/adsr2/ControlPanelADSR2';
import { getSynthDesignerReduxInfra, type FilterParams } from 'src/redux/modules/synthDesigner';
import { getSettingsForFilterType } from 'src/synthDesigner/filterHelpers';

const style = { width: 600 };

interface FilterProps {
  params: FilterParams;
  synthIx: number;
  filterEnvelope: ADSRWithOutputRange;
  bypass: boolean;
  stateKey: string;
  adsrLengthMs: number;
  enableEnvelope: boolean;
}

export const Filter: React.FC<FilterProps> = ({
  params,
  synthIx,
  filterEnvelope,
  bypass,
  stateKey,
  adsrLengthMs,
  enableEnvelope,
}) => {
  const vcId = stateKey.split('_')[1];
  const settings = useMemo(
    () =>
      getSettingsForFilterType(
        params.type,
        {
          adsrAudioThreadData: filterEnvelope.audioThreadData ?? {
            phaseIndex: 0,
            debugName: 'No audio thread data in synth designer `filterEnvelope`',
          },
        },
        undefined,
        vcId,
        'synthDesignerFilter'
      ),
    [filterEnvelope.audioThreadData, params.type, vcId]
  );
  if (!filterEnvelope.outputRange) {
    console.error('Missing `outputRange` on `filterEnvelope` provided to `<Filter />`');
  }
  const state = useMemo(() => {
    const state = {
      ...params,
      adsr: filterEnvelope,
      bypass,
      'adsr length ms': adsrLengthMs,
      'enable envelope': enableEnvelope,
    };
    if (!R.isNil(state.Q) && Number.isNaN(state.Q)) {
      console.warn('NaN Q found for filter; normalizing...');
      state.Q = 1;
    }
    return state;
  }, [params, filterEnvelope, bypass, adsrLengthMs, enableEnvelope]);
  const { dispatch, actionCreators } = getSynthDesignerReduxInfra(stateKey);
  const handleChange = useCallback(
    (key: string, val: any) => {
      if (key === 'adsr') {
        dispatch(actionCreators.synthDesigner.SET_FILTER_ADSR(val, synthIx));
        return;
      } else if (key === 'bypass') {
        dispatch(actionCreators.synthDesigner.SET_FILTER_IS_BYPASSED(synthIx, val));
      } else if (key === 'adsr length ms') {
        dispatch(actionCreators.synthDesigner.SET_FILTER_ADSR_LENGTH(synthIx, val));
      } else if (key === 'enable envelope') {
        dispatch(actionCreators.synthDesigner.SET_FILTER_ENVELOPE_ENABLED(synthIx, val));
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
