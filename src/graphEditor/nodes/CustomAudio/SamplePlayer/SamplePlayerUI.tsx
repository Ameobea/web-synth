import * as R from 'ramda';
import React, { useCallback, useMemo, useReducer, useRef } from 'react';
import ControlPanel from 'react-control-panel';

import type {
  SampleCrossfadeParams,
  SamplePlayerSampleDescriptor,
} from 'src/graphEditor/nodes/CustomAudio/SamplePlayer/SamplePlayer';
import type { SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';
import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';
import { filterNils } from 'src/util';

const MAX_SAMPLE_COUNT = 8;

interface SamplePlayerUIProps {
  initialState: SamplePlayerSampleDescriptor[];
  addSample: (descriptor: SampleDescriptor, id: string, gain?: number | undefined) => void;
  removeSample: (index: number) => void;
  setSampleGain: (index: number, gain: number) => void;
  setSampleCrossfadeParams: (index: number, crossfadeParams: SampleCrossfadeParams) => void;
  setSampleDescriptor: (index: number, descriptor: SampleDescriptor) => void;
}

type SamplePlayerUIState = SamplePlayerSampleDescriptor[];

type SamplePlayerUIAction =
  | { type: 'SET_GAIN'; index: number; gain: number }
  | { type: 'SET_CROSSFADE_PARAMS'; index: number; crossfadeParams: SampleCrossfadeParams }
  | { type: 'SET_SAMPLE'; index: number; descriptor: SampleDescriptor }
  | { type: 'ADD_SAMPLE'; descriptor: SampleDescriptor }
  | { type: 'REMOVE_SAMPLE'; index: number };

const buildDefaultSlot = (descriptor: SampleDescriptor): SamplePlayerSampleDescriptor => ({
  id: btoa(Math.random().toString()),
  gain: 1,
  sample: null,
  descriptor,
  crossfadeParams: { enabled: false, threshold: 0 },
});

const mkSamplePlayerUIReducer =
  ({
    addSample,
    removeSample,
    setSampleGain,
    setSampleCrossfadeParams,
    setSampleDescriptor,
  }: Pick<
    SamplePlayerUIProps,
    | 'addSample'
    | 'removeSample'
    | 'setSampleGain'
    | 'setSampleCrossfadeParams'
    | 'setSampleDescriptor'
  >) =>
  (state: SamplePlayerUIState, action: SamplePlayerUIAction): SamplePlayerUIState => {
    switch (action.type) {
      case 'SET_GAIN': {
        const slot = state[action.index];
        setSampleGain(action.index, action.gain);
        return R.set(R.lensIndex(action.index), { ...slot, gain: action.gain }, state);
      }
      case 'SET_CROSSFADE_PARAMS': {
        const slot = state[action.index];
        setSampleCrossfadeParams(action.index, action.crossfadeParams);
        return R.set(
          R.lensIndex(action.index),
          { ...slot, crossfadeParams: action.crossfadeParams },
          state
        );
      }
      case 'SET_SAMPLE': {
        const slot = state[action.index] ?? buildDefaultSlot(action.descriptor);
        setSampleDescriptor(action.index, action.descriptor);
        return R.set(R.lensIndex(action.index), { ...slot, descriptor: action.descriptor }, state);
      }
      case 'ADD_SAMPLE': {
        const id = btoa(Math.random().toString());
        addSample(action.descriptor, id);
        return [
          ...state,
          {
            id,
            descriptor: action.descriptor,
            gain: 1,
            sample: null,
            crossfadeParams: { enabled: false, threshold: 0 },
          },
        ];
      }
      case 'REMOVE_SAMPLE': {
        removeSample(action.index);
        return R.remove(action.index, 1, state);
      }
      default: {
        console.error('Unhandled `mkSamplePlayerUIReducer` action type: ', (action as any).type);
        return state;
      }
    }
    return state;
  };

interface ConfigureSampleProps {
  index: number;
  descriptor: SamplePlayerSampleDescriptor;
  dispatch: (action: SamplePlayerUIAction) => void;
}

const ConfigureSample: React.FC<ConfigureSampleProps> = ({ index, descriptor, dispatch }) => {
  const initialState = useRef({
    gain: descriptor.gain,
    'enable crossfade': descriptor.crossfadeParams.enabled,
    'crossfade threshold': descriptor.crossfadeParams.threshold,
  });
  const settings = useMemo(
    () =>
      filterNils([
        { type: 'range', label: 'gain', min: 0, max: 3 },
        {
          type: 'button',
          label: 'pick new sample',
          action: async () => {
            const descriptor = await selectSample();
            dispatch({ type: 'SET_SAMPLE', index, descriptor });
          },
        },
        { type: 'checkbox', label: 'enable crossfade' },
        descriptor.crossfadeParams.enabled
          ? { type: 'range', label: 'crossfade threshold', min: 0, max: 1 }
          : null,
        {
          type: 'button',
          label: 'delete',
          action: () => dispatch({ type: 'REMOVE_SAMPLE', index }),
        },
      ]),
    [dispatch, index, descriptor.crossfadeParams.enabled]
  );

  const handleChange = useCallback(
    (key: string, value: any, _state: any) => {
      switch (key) {
        case 'gain': {
          dispatch({ type: 'SET_GAIN', index, gain: value });
          break;
        }
        case 'enable crossfade': {
          dispatch({
            type: 'SET_CROSSFADE_PARAMS',
            index,
            crossfadeParams: { enabled: value, threshold: descriptor.crossfadeParams.threshold },
          });
          break;
        }
        case 'crossfade threshold': {
          dispatch({
            type: 'SET_CROSSFADE_PARAMS',
            index,
            crossfadeParams: { enabled: true, threshold: value },
          });
          break;
        }
        default: {
          console.error('Unhandled key in `ConfigureSample`: ' + key);
        }
      }
    },
    [descriptor.crossfadeParams.threshold, dispatch, index]
  );

  return (
    <div style={{ width: '100%' }}>
      Selected Sample: {descriptor.descriptor.name}
      <ControlPanel
        initialState={initialState.current}
        settings={settings}
        onChange={handleChange}
        style={{ width: '100%' }}
      />
    </div>
  );
};

interface AddNewSampleProps {
  dispatch: (action: SamplePlayerUIAction) => void;
}

const AddNewSample: React.FC<AddNewSampleProps> = ({ dispatch }) => {
  const settings = useMemo(
    () => [
      {
        type: 'button',
        label: 'add new sample',
        action: async () => {
          const descriptor = await selectSample();
          dispatch({ type: 'ADD_SAMPLE', descriptor });
        },
      },
    ],
    [dispatch]
  );

  return <ControlPanel settings={settings} style={{ width: '100%' }} />;
};

const SamplePlayerUI: React.FC<SamplePlayerUIProps> = ({
  initialState,
  addSample,
  removeSample,
  setSampleGain,
  setSampleCrossfadeParams,
  setSampleDescriptor,
}) => {
  const reducer = useMemo(
    () =>
      mkSamplePlayerUIReducer({
        addSample,
        removeSample,
        setSampleGain,
        setSampleCrossfadeParams,
        setSampleDescriptor,
      }),
    [addSample, removeSample, setSampleDescriptor, setSampleGain, setSampleCrossfadeParams]
  );
  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <div className='sample-player-small-view' style={{ width: '100%' }}>
      {state.map((slot, i) => {
        return <ConfigureSample key={slot.id} index={i} descriptor={slot} dispatch={dispatch} />;
      })}
      {state.length < MAX_SAMPLE_COUNT ? <AddNewSample dispatch={dispatch} /> : null}
    </div>
  );
};

export default SamplePlayerUI;
