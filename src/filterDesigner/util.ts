import * as R from 'ramda';

import type { FilterParams } from 'src/redux/modules/synthDesigner';

const ctx = new AudioContext();

export interface FilterDescriptor {
  params: FilterParams;
  filter: BiquadFilterNode;
  id: string;
}
export type FilterGroup = FilterDescriptor[];

export interface FilterDesignerState {
  filterGroups: FilterGroup[];
  lockedFrequencyByGroup: (number | null | undefined)[];
}

export interface SerializedFilterDesigner {
  filterGroups: FilterParams[][];
  lockedFrequencyByGroup: (number | null | undefined)[] | undefined;
}

export const serializeFilterDesigner = (state: FilterDesignerState): string => {
  const serialized: SerializedFilterDesigner = {
    filterGroups: state.filterGroups.map(filters => filters.map(R.prop('params'))),
    lockedFrequencyByGroup: state.lockedFrequencyByGroup,
  };
  return JSON.stringify(serialized);
};

export const deserializeFilterDesigner = (
  parsed: SerializedFilterDesigner
): FilterDesignerState => {
  const filterGroups = parsed.filterGroups.map((group, groupIx) => {
    const activatedGroup = group.map(params => {
      const filter = new BiquadFilterNode(ctx);
      setFilter(filter, params, parsed.lockedFrequencyByGroup?.[groupIx] ?? params.frequency);
      return { params, filter, id: btoa(Math.random().toString()) };
    });

    connectFilterChain(activatedGroup.map(R.prop('filter')));
    return activatedGroup;
  });

  return {
    filterGroups,
    lockedFrequencyByGroup: parsed.lockedFrequencyByGroup ?? [],
  };
};

export const setFilter = (
  filter: BiquadFilterNode,
  params: FilterParams,
  lockedFrequency: number | null | undefined
) => {
  filter.type = params.type;
  filter.Q.value = params.Q ?? 0;
  filter.detune.value = params.detune;
  filter.gain.value = params.gain;
  if (!R.isNil(lockedFrequency)) {
    filter.frequency.value = lockedFrequency;
  } else {
    filter.frequency.value = params.frequency;
  }
};

export const connectFilterChain = (filters: BiquadFilterNode[]) => {
  const [firstFilter, ...rest] = filters;
  rest.reduce((acc, filter) => {
    acc.connect(filter);
    return filter;
  }, firstFilter);
};

export const disconnectFilterChain = (filters: BiquadFilterNode[]) => {
  const [firstFilter, ...rest] = filters;
  rest.reduce((acc, filter) => {
    acc.disconnect(filter);
    return filter;
  }, firstFilter);
};
