import React, { Suspense } from 'react';
import { PropTypesOf, UnreachableException } from 'ameo-utils';
import { Option } from 'funfix-core';
import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';

import Loading from 'src/misc/Loading';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';

import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';
import { FilterParams } from 'src/redux/modules/synthDesigner';
import { create_empty_audio_connectables } from 'src/redux/modules/vcmUtils';
import { FilterType } from 'src/synthDesigner/filterHelpers';
import {
  FilterDesignerState,
  deserializeFilterDesigner,
  serializeFilterDesigner,
  setFilter,
  connectFilterChain,
} from 'src/filterDesigner/util';
import { updateConnectables } from 'src/patchNetwork/interface';

const FilterDesigner = React.lazy(() => import('./FilterDesigner'));

const LazyFilterDesignerUI: React.FC<PropTypesOf<typeof FilterDesigner>> = props => (
  <Suspense fallback={<Loading />}>
    <FilterDesigner {...props} />
  </Suspense>
);

const ctx = new AudioContext();
const StatesByVcId = new Map<string, FilterDesignerState>();

const buildDefaultFilterDesignerState = (): FilterDesignerState => {
  const filterParams: FilterParams[] = [
    { type: FilterType.Lowpass, frequency: 1000, Q: 0.71, gain: 0, detune: 0 },
    { type: FilterType.Lowpass, frequency: 8800, Q: 11.71, gain: 0, detune: 0 },
  ];

  const filters = filterParams.map(params => {
    const filter = new BiquadFilterNode(ctx);
    setFilter(filter, params, null);
    return { params, filter, id: btoa(Math.random().toString()) };
  });
  connectFilterChain(filters.map(R.prop('filter')));

  return {
    filters,
    lockedFrequency: null,
  };
};

const getFilterDesignerDOMElementId = (vcId: string) => `filterDesigner_${vcId}`;

export const init_filter_designer = async (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const domId = getFilterDesignerDOMElementId(vcId);
  const elem = document.createElement('div');
  elem.id = domId;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: 100vh; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const serialized = localStorage.getItem(stateKey);
  const initialState: FilterDesignerState = Option.of(serialized)
    .map(s => deserializeFilterDesigner(JSON.parse(s)))
    .getOrElseL(buildDefaultFilterDesignerState);
  StatesByVcId.set(vcId, initialState);

  const onChange = (newState: FilterDesignerState) => {
    StatesByVcId.set(vcId, newState);
  };

  mkContainerRenderHelper({
    Comp: LazyFilterDesignerUI,
    getProps: () => ({
      vcId,
      initialState,
      onChange,
      updateConnectables: (newState?: FilterDesignerState) =>
        updateConnectables(vcId, get_filter_designer_audio_connectables(vcId, newState)),
    }),
  })(domId);
};

export const cleanup_filter_designer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const state = StatesByVcId.get(vcId);
  if (!state) {
    console.warn('Missing filter designer state for vcId=' + vcId);
  } else {
    const serialized = serializeFilterDesigner(state);
    localStorage.setItem(stateKey, serialized);
    StatesByVcId.delete(vcId);
  }

  mkContainerCleanupHelper()(getFilterDesignerDOMElementId(vcId));
};

export const hide_filter_designer = mkContainerHider(getFilterDesignerDOMElementId);

export const unhide_filter_designer = mkContainerUnhider(getFilterDesignerDOMElementId);

export const get_filter_designer_audio_connectables = (
  vcId: string,
  stateOverride?: FilterDesignerState
): AudioConnectables => {
  const state = stateOverride ?? StatesByVcId.get(vcId);
  if (!state) {
    throw new UnreachableException('Missing state for filter designer vcId=' + vcId);
  }
  if (state.filters.length === 0 || !state.filters[0]) {
    return create_empty_audio_connectables(vcId);
  }

  return dbg({
    vcId,
    inputs: ImmMap<string, ConnectableInput>().set('input', {
      type: 'customAudio',
      node: state.filters[0].filter,
    }),
    outputs: ImmMap<string, ConnectableOutput>().set('output', {
      type: 'customAudio',
      node: state.filters[state.filters.length - 1].filter,
    }),
  });
};
