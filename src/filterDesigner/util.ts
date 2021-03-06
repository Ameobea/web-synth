import * as R from 'ramda';

import { FilterParams } from 'src/redux/modules/synthDesigner';

const ctx = new AudioContext();

export interface FilterDesignerState {
  filters: { params: FilterParams; filter: BiquadFilterNode; id: string }[];
  lockedFrequency: number | null;
}

export interface SerializedFilterDesigner {
  filters: FilterParams[];
  lockedFrequency: number | null | undefined;
}

export const serializeFilterDesigner = (state: FilterDesignerState): string => {
  const serialized: SerializedFilterDesigner = {
    filters: state.filters.map(R.prop('params')),
    lockedFrequency: state.lockedFrequency,
  };
  return JSON.stringify(serialized);
};

export const deserializeFilterDesigner = (
  parsed: SerializedFilterDesigner
): FilterDesignerState => {
  const filters = parsed.filters.map(params => {
    const filter = new BiquadFilterNode(ctx);
    setFilter(filter, params, parsed.lockedFrequency);
    return { params, filter, id: btoa(Math.random().toString()) };
  });
  connectFilterChain(filters.map(R.prop('filter')));

  return {
    filters,
    lockedFrequency: parsed.lockedFrequency ?? null,
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
