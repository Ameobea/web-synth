import * as R from 'ramda';

import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { FilterType } from 'src/synthDesigner/FilterType';

const ctx = new AudioContext();

export interface FilterDescriptor {
  params: FilterParams;
  filter: BiquadFilterNode;
  oaps: {
    frequency: OverridableAudioParam;
    Q: OverridableAudioParam;
    gain: OverridableAudioParam;
  };
  id: string;
}
export type FilterGroup = FilterDescriptor[];

export interface FilterDesignerState {
  input: GainNode;
  filterGroups: FilterGroup[];
  lockedFrequencyByGroup: (number | null | undefined)[];
}

export interface SerializedFilterDesigner {
  filterGroups: FilterParams[][];
  lockedFrequencyByGroup: (number | null | undefined)[] | undefined;
}

export const serializeFilterDesigner = (state: FilterDesignerState): string => {
  const serialized: SerializedFilterDesigner = {
    filterGroups: state.filterGroups.map(filters => filters.map(f => f.params)),
    lockedFrequencyByGroup: state.lockedFrequencyByGroup,
  };
  return JSON.stringify(serialized);
};

export const deserializeFilterDesigner = (
  parsed: SerializedFilterDesigner
): FilterDesignerState => {
  const input = ctx.createGain();
  input.gain.value = 1;

  const filterGroups = parsed.filterGroups.map((group, groupIx) => {
    const activatedGroup = group.map(params => {
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
      setFilter(filter, oaps, params, parsed.lockedFrequencyByGroup?.[groupIx] ?? params.frequency);
      return { params, filter, oaps, id: btoa(Math.random().toString()) };
    });

    connectFilterChain(activatedGroup.map(g => g.filter));
    input.connect(activatedGroup[0].filter);
    return activatedGroup;
  });

  return {
    input,
    filterGroups,
    lockedFrequencyByGroup: parsed.lockedFrequencyByGroup ?? [],
  };
};

export const setFilter = (
  filter: BiquadFilterNode,
  oaps: FilterDescriptor['oaps'] | undefined,
  params: FilterParams,
  lockedFrequency: number | null | undefined
) => {
  if (
    params.type === FilterType.HP4 ||
    params.type === FilterType.HP8 ||
    params.type === FilterType.HP16 ||
    params.type === FilterType.LP4 ||
    params.type === FilterType.LP8 ||
    params.type === FilterType.LP16 ||
    params.type === FilterType.BP4 ||
    params.type === FilterType.BP8 ||
    params.type === FilterType.BP16 ||
    params.type === FilterType.DynaBP_100 ||
    params.type === FilterType.DynaBP_200 ||
    params.type === FilterType.DynaBP_400 ||
    params.type === FilterType.DynaBP_50 ||
    params.type === FilterType.DynaBP_800
  ) {
    console.error('Filter type not supported', params.type);
  } else {
    filter.type = params.type;
  }

  const frequency = R.isNil(lockedFrequency) ? params.frequency : lockedFrequency;

  if (oaps) {
    oaps.frequency.manualControl.offset.value = frequency;
    oaps.Q.manualControl.offset.value = params.Q ?? 1;
    oaps.gain.manualControl.offset.value = params.gain;
  } else {
    filter.frequency.value = frequency;
    filter.Q.value = params.Q ?? 1;
    filter.gain.value = params.gain;
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
    try {
      acc.disconnect(filter);
    } catch (_err) {
      // pass
    }
    return filter;
  }, firstFilter);
};
