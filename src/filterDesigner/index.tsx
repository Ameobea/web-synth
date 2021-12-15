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
import type { FilterParams } from 'src/redux/modules/synthDesigner';
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
  const input = ctx.createGain();
  input.gain.value = 1;

  const filterParams: FilterParams[] = [
    { type: FilterType.Lowpass, frequency: 1000, Q: 0.71, gain: 0, detune: 0 },
    { type: FilterType.Lowpass, frequency: 8800, Q: 11.71, gain: 0, detune: 0 },
  ];

  const filterGroups = [
    filterParams.map(params => {
      const filter = new BiquadFilterNode(ctx);
      setFilter(filter, params, null);
      return { params, filter, id: btoa(Math.random().toString()) };
    }),
  ];
  connectFilterChain(filterGroups[0].map(R.prop('filter')));
  input.connect(filterGroups[0][0].filter);

  return {
    input,
    filterGroups,
    lockedFrequencyByGroup: [null],
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
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none;'
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
  if (
    state.filterGroups.length === 0 ||
    !state.filterGroups[0] ||
    state.filterGroups.every(group => group.length === 0 || !group[0])
  ) {
    return create_empty_audio_connectables(vcId);
  }

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>().set('input', {
      type: 'customAudio',
      node: state.input,
    }),
    outputs: state.filterGroups.reduce(
      (acc, group, groupIx) =>
        acc.set(`group ${groupIx + 1} output`, {
          type: 'customAudio',
          node: group[group.length - 1].filter,
        }),
      ImmMap<string, ConnectableOutput>()
    ),
  };
};
