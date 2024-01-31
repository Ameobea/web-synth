import { Option } from 'funfix-core';
import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import React, { Suspense } from 'react';

import {
  connectFilterChain,
  deserializeFilterDesigner,
  type FilterDesignerState,
  serializeFilterDesigner,
  setFilter,
} from 'src/filterDesigner/util';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import Loading from 'src/misc/Loading';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';
import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { create_empty_audio_connectables } from 'src/redux/modules/vcmUtils';
import { FilterType } from 'src/synthDesigner/FilterType';
import { UnreachableError, type PropTypesOf } from 'src/util';

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
    { type: FilterType.Lowpass, frequency: 1000, Q: 0.71, gain: 0 },
    { type: FilterType.Lowpass, frequency: 8800, Q: 11.71, gain: 0 },
  ];

  const filterGroups = [
    filterParams.map(params => {
      const filter = new BiquadFilterNode(ctx);
      filter.frequency.value = 0;
      filter.detune.value = 0;
      filter.Q.value = 0;
      filter.gain.value = 0;
      const oaps = {
        frequency: new OverridableAudioParam(ctx, filter.frequency, undefined, true),
        Q: new OverridableAudioParam(ctx, filter.Q, undefined, true),
        gain: new OverridableAudioParam(ctx, filter.gain, undefined, true),
      };
      setFilter(filter, oaps, params, null);
      return { params, filter, oaps, id: btoa(Math.random().toString()) };
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
    throw new UnreachableError('Missing state for filter designer vcId=' + vcId);
  }
  if (
    state.filterGroups.length === 0 ||
    !state.filterGroups[0] ||
    state.filterGroups.every(group => group.length === 0 || !group[0])
  ) {
    return create_empty_audio_connectables(vcId);
  }

  let inputs = ImmMap<string, ConnectableInput>().set('input', {
    type: 'customAudio',
    node: state.input,
  });
  for (const [groupIx, group] of state.filterGroups.entries()) {
    for (const [filterIx, { filter }] of group.entries()) {
      inputs = inputs
        .set(`group_${groupIx}_filter_${filterIx}_frequency`, {
          node: filter.frequency,
          type: 'number',
        })
        .set(`group_${groupIx}_filter_${filterIx}_q`, { node: filter.Q, type: 'number' });
    }
  }

  return {
    vcId,
    inputs,
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
