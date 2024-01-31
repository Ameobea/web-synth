import * as R from 'ramda';
import React, { useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import {
  mkControlPanelADSR2WithSize,
  type ADSRWithOutputRange,
} from 'src/controls/adsr2/ControlPanelADSR2';
import { buildDefaultADSR2Envelope } from 'src/controls/adsr2/adsr2Helpers';
import { AdsrLengthMode } from 'src/graphEditor/nodes/CustomAudio/FMSynth';
import { getSynthDesignerReduxInfra, type FilterParams } from 'src/redux/modules/synthDesigner';
import { getSettingsForFilterType } from 'src/synthDesigner/filterHelpers';
import { UnreachableError } from 'src/util';

const style = { width: 600 };

const getDefaultLengthForAdsrLengthMode = (lengthMode: AdsrLengthMode) => {
  switch (lengthMode) {
    case AdsrLengthMode.Beats:
      return 1;
    case AdsrLengthMode.Samples:
      return 1000;
    default:
      throw new UnreachableError(`Unknown length mode: ${lengthMode}`);
  }
};

interface FilterEnvelopeControlsProps {
  stateKey: string;
  synthIx: number;
  length: number;
  filterEnvelope: ADSRWithOutputRange;
}

const FilterEnvelopeControls: React.FC<FilterEnvelopeControlsProps> = ({
  stateKey,
  synthIx,
  length,
  filterEnvelope,
}) => {
  const lengthMode = filterEnvelope.lengthMode ?? AdsrLengthMode.Samples;
  const lengthKey = lengthMode === AdsrLengthMode.Beats ? 'beats' : 'millis';
  const ADSRControlsComp = useMemo(
    () =>
      mkControlPanelADSR2WithSize(500, 320, undefined, 'synth designer `FilterEnvelopeControls`'),
    []
  );
  const settings = useMemo(
    () => [
      { type: 'multibox', label: 'length mode', names: ['millis', 'beats'] },
      lengthMode === AdsrLengthMode.Beats
        ? { type: 'range', label: 'beats', min: 1 / 16, max: 8, step: 1 / 16 }
        : { type: 'range', label: 'millis', min: 40, max: 8000, scale: 'log' },
      {
        type: 'custom',
        label: 'adsr',
        initial: {
          ...buildDefaultADSR2Envelope(
            filterEnvelope.audioThreadData ?? {
              phaseIndex: 0,
              debugName: 'No audio thread data in synth designer `filterEnvelope`',
            }
          ),
          outputRange: [20, 20_000],
          logScale: true,
        },
        Comp: ADSRControlsComp,
      },
    ],
    [ADSRControlsComp, filterEnvelope.audioThreadData, lengthMode]
  );

  const state = useMemo(
    () => ({
      'length mode': (() => {
        switch (lengthMode) {
          case AdsrLengthMode.Beats:
            return [false, true];
          case AdsrLengthMode.Samples:
            return [true, false];
          default:
            throw new UnreachableError(`Unexpected length mode: ${lengthMode}`);
        }
      })(),
      [lengthKey]: length,
      adsr: { ...filterEnvelope, logScale: true },
    }),
    [lengthMode, lengthKey, length, filterEnvelope]
  );

  const { dispatch, actionCreators } = getSynthDesignerReduxInfra(stateKey);

  const handleChange = useCallback(
    (key: string, val: any) => {
      switch (key) {
        case 'length mode': {
          const newLengthMode =
            lengthMode === AdsrLengthMode.Beats ? AdsrLengthMode.Samples : AdsrLengthMode.Beats;
          const length = getDefaultLengthForAdsrLengthMode(newLengthMode);
          dispatch(
            actionCreators.synthDesigner.SET_FILTER_ADSR_LENGTH(synthIx, length, newLengthMode)
          );
          return;
        }
        case lengthKey: {
          dispatch(actionCreators.synthDesigner.SET_FILTER_ADSR_LENGTH(synthIx, val, lengthMode));
          return;
        }
        case 'adsr': {
          dispatch(
            actionCreators.synthDesigner.SET_FILTER_ADSR(
              { ...val, lenSamples: length, lengthMode },
              synthIx
            )
          );
          return;
        }
        default:
          console.warn(`Unhandled key in \`FilterEnvelopeControls\` control panel: ${key}`);
          return;
      }
    },
    [actionCreators.synthDesigner, dispatch, length, lengthKey, lengthMode, synthIx]
  );

  return (
    <ControlPanel
      className='filter-adsr-control-panel'
      style={style}
      title='FILTER ENVELOPE'
      settings={settings}
      state={state}
      onChange={handleChange}
    />
  );
};

interface FilterProps {
  params: FilterParams;
  synthIx: number;
  filterEnvelope: ADSRWithOutputRange;
  bypass: boolean;
  stateKey: string;
  adsrLength: number;
  enableEnvelope: boolean;
}

export const Filter: React.FC<FilterProps> = ({
  params,
  synthIx,
  filterEnvelope,
  bypass,
  stateKey,
  adsrLength,
  enableEnvelope,
}) => {
  const vcId = stateKey.split('_')[1];
  const settings = useMemo(
    () => [
      ...getSettingsForFilterType({
        filterType: params.type,
        includeADSR: false,
        includeBypass: undefined,
        vcId,
      }),
      { type: 'checkbox', label: 'enable envelope', initial: true },
    ],
    [params.type, vcId]
  );
  if (!filterEnvelope.outputRange) {
    console.error('Missing `outputRange` on `filterEnvelope` provided to `<Filter />`');
  }
  const state = useMemo(() => {
    const state = {
      ...params,
      bypass,
      'enable envelope': enableEnvelope,
    };
    if (!R.isNil(state.Q) && Number.isNaN(state.Q)) {
      console.warn('NaN Q found for filter; normalizing...');
      state.Q = 1;
    }
    return state;
  }, [params, bypass, enableEnvelope]);
  const { dispatch, actionCreators } = getSynthDesignerReduxInfra(stateKey);
  const handleChange = useCallback(
    (key: string, val: any) => {
      if (key === 'bypass') {
        dispatch(actionCreators.synthDesigner.SET_FILTER_IS_BYPASSED(synthIx, val));
      } else if (key === 'enable envelope') {
        dispatch(actionCreators.synthDesigner.SET_FILTER_ENVELOPE_ENABLED(synthIx, val));
      }

      dispatch(actionCreators.synthDesigner.SET_FILTER_PARAM(synthIx, key as any, val));
    },
    [actionCreators.synthDesigner, dispatch, synthIx]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <ControlPanel
        className='filter-control-panel'
        style={style}
        title='FILTER'
        settings={settings}
        state={state}
        onChange={handleChange}
      />
      {enableEnvelope ? (
        <FilterEnvelopeControls
          stateKey={stateKey}
          synthIx={synthIx}
          length={adsrLength}
          filterEnvelope={filterEnvelope}
        />
      ) : null}
    </div>
  );
};
