import { filterNils } from 'ameo-utils';
import type { ScaleLogarithmic, Selection } from 'd3';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';
import * as R from 'ramda';

import type { FilterParams } from 'src/redux/modules/synthDesigner';
import {
  buildDefaultFilter,
  FilterType,
  getSettingsForFilterType,
} from 'src/synthDesigner/filterHelpers';
import { linearToDb } from 'src/util';
import d3 from './d3';
import './FilterDesigner.scss';
import FlatButton from 'src/misc/FlatButton';
import {
  connectFilterChain,
  deserializeFilterDesigner,
  disconnectFilterChain,
  FilterDescriptor,
  FilterDesignerState,
  FilterGroup,
  setFilter,
} from 'src/filterDesigner/util';
import Presets from './presets';
import { useWhyDidYouUpdate } from 'src/reactUtils';

const ctx = new AudioContext();
const DATA_SIZE = 512;
const WIDTH = 800;
const HEIGHT = 350;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 20;
const MARGIN_RIGHT = 10;
const MARGIN_LEFT = 40;
const LINE_COLOR = '#008387';

const min = 10;
const max = 44_050 / 2;
const scaleValue = (x: number) =>
  Math.exp(Math.log(min) + ((Math.log(max) - Math.log(min)) * (x / DATA_SIZE) * 100) / 100);
const FREQUENCIES = new Float32Array(DATA_SIZE).map((_, i) => scaleValue(i));

interface FilterInstProps {
  groupIx: number;
  filterIx: number;
  lockedFrequency: number | null;
  filter: FilterDescriptor;
  onChange: (groupIx: number, filterIx: number, newParams: FilterParams) => void;
  onDelete: (filterIx: number) => void;
}

const FilterInstInner: React.FC<FilterInstProps> = ({
  groupIx,
  filterIx,
  lockedFrequency,
  filter: { params, filter },
  onChange,
  onDelete,
}) => {
  const settings = useMemo(() => {
    const settings = getSettingsForFilterType(params.type, false, false);
    return !R.isNil(lockedFrequency)
      ? settings.filter(setting => setting.label !== 'frequency')
      : settings;
  }, [params.type, lockedFrequency]);
  const state = useMemo(
    () => ({
      type: params.type,
      frequency: params.frequency,
      Q: params.Q,
      detune: params.detune,
      gain: params.gain,
    }),
    [params.Q, params.detune, params.frequency, params.gain, params.type]
  );
  const handleChange = useCallback(
    (key: string, val: any) => {
      const newParams: FilterParams = { ...params, [key]: val };
      setFilter(filter, newParams, lockedFrequency);
      onChange(groupIx, filterIx, newParams);
    },
    [filter, groupIx, filterIx, lockedFrequency, onChange, params]
  );

  return (
    <div className='filter-inst'>
      <FlatButton onClick={() => onDelete(filterIx)}>×</FlatButton>
      <ControlPanel width={700} settings={settings} onChange={handleChange} state={state} />
    </div>
  );
};

const FilterInst = React.memo(FilterInstInner);

interface FilterParamsEditorProps {
  lockedFrequency: number | null;
  group: FilterGroup;
  groupIx: number;
  onChange: (mapState: (state: FilterDesignerState) => FilterDesignerState) => void;
  onDelete: (filterIx: number) => void;
}

const FilterParamsEditorInner: React.FC<FilterParamsEditorProps> = ({
  lockedFrequency,
  group,
  groupIx,
  onChange,
  onDelete,
}) => {
  useWhyDidYouUpdate(
    'FiltereParamsEditorComponent',
    groupIx === 0
      ? {
          lockedFrequency,
          group,
          groupIx,
          onChange,
          onDelete,
        }
      : {}
  );
  const onInstChange = useCallback(
    (groupIx: number, filterIx: number, newParams: FilterParams) =>
      onChange((state: FilterDesignerState): FilterDesignerState => {
        const newFilterGroups = [...state.filterGroups];
        const newFiltersForGroup = [...newFilterGroups[groupIx]];
        newFiltersForGroup[filterIx] = { ...newFiltersForGroup[filterIx], params: newParams };
        newFilterGroups[groupIx] = newFiltersForGroup;
        return { ...state, filterGroups: newFilterGroups };
      }),
    [onChange]
  );

  return (
    <div className='filter-params'>
      {group.map((filter, filterIx) => (
        <FilterInst
          groupIx={groupIx}
          filterIx={filterIx}
          onDelete={onDelete}
          key={filter.id}
          lockedFrequency={lockedFrequency}
          filter={filter}
          onChange={onInstChange}
        />
      ))}
    </div>
  );
};

const FilterParamsEditor = React.memo(FilterParamsEditorInner);

class FilterDesigner {
  private state: FilterDesignerState;
  private containerId: string;
  private svg!: Selection<SVGGElement, unknown, HTMLElement, any>;
  private x!: ScaleLogarithmic<number, number, never>;
  private prevMaxVal = -Infinity;

  constructor(initialState: FilterDesignerState, containerId: string) {
    this.state = initialState;
    this.containerId = containerId;

    this.renderInitial();
    this.onUpdated(this.state);
  }

  public onUpdated(
    update: FilterDesignerState | ((oldState: FilterDesignerState) => FilterDesignerState)
  ) {
    const newState = typeof update === 'function' ? update(this.state) : update;
    this.state = newState;

    const individualFrequencyResponsesByGroup = this.state.filterGroups.map(group =>
      group.map(({ filter }) => {
        const responses = new Float32Array(DATA_SIZE);
        filter.getFrequencyResponse(FREQUENCIES, responses, new Float32Array(DATA_SIZE));
        return responses;
      })
    );
    // Filters within eacn group are applied in series
    const aggregateResponsesByGroup = individualFrequencyResponsesByGroup.map(responesForGroup =>
      responesForGroup.reduce((acc, res) => {
        acc.forEach((y, i) => {
          const val = Number.isNaN(res[i]) ? 0 : res[i];
          acc[i] = y * val;
        });
        return acc;
      }, new Float32Array(DATA_SIZE).fill(1))
    );
    // Filter groups are then routed in parallel
    const aggResponses = aggregateResponsesByGroup.reduce((acc, res) => {
      acc.forEach((y, i) => {
        const val = Number.isNaN(res[i]) ? 0 : res[i];
        acc[i] = y + val;
      });
      return acc;
    }, new Float32Array(DATA_SIZE).fill(0));

    this.render(FREQUENCIES, aggResponses);
  }

  private renderInitial() {
    this.svg = d3
      .select('#' + this.containerId)
      .append('svg')
      .attr('width', WIDTH + MARGIN_LEFT + MARGIN_RIGHT)
      .attr('height', HEIGHT + MARGIN_TOP + MARGIN_BOTTOM)
      .append('g')
      .attr('transform', `translate(${MARGIN_LEFT}, ${MARGIN_TOP})`);
    this.x = d3
      .scaleLog()
      .domain([10, 44_050 / 2])
      .range([0, WIDTH]);
    this.svg
      .append('g')
      .attr('transform', `translate(0, ${HEIGHT})`)
      .call(d3.axisBottom(this.x).ticks(12, ',.1s').tickSize(6));
  }

  public render(frequencies: Float32Array, frequencyResponses: Float32Array) {
    const containerExists = !!document.querySelector(`#${this.containerId} svg`);
    if (!containerExists) {
      this.renderInitial();
    }

    // Clear previous rendering if it exists
    document.querySelector(`#${this.containerId} .chart-data`)?.remove();

    const maxVal = Math.max(
      linearToDb(frequencyResponses.reduce((acc, val) => Math.max(acc, val), 0)),
      10
    );
    const y = d3.scaleLinear().domain([-80, maxVal]).range([HEIGHT, 0]);
    if (maxVal !== this.prevMaxVal || !containerExists) {
      document.querySelector(`#${this.containerId} .y-axis`)?.remove();
      document.querySelector(`#${this.containerId} .axis-line`)?.remove();

      this.svg
        .append('g')
        .attr('class', 'y-axis')
        .call(
          d3
            .axisLeft(y)
            .ticks(10)
            .tickFormat(val => (typeof val === 'number' ? val : val.valueOf()).toFixed(0))
        );

      this.svg
        .append('line')
        .attr('class', 'axis-line')
        .attr('fill', 'none')
        .attr('stroke', '#ffffff88')
        .attr('stroke-width', 1)
        .attr('x1', 0)
        .attr('x2', WIDTH)
        .attr('y1', y(0))
        .attr('y2', y(0));
    }
    this.prevMaxVal = maxVal;

    this.svg
      .append('path')
      .attr('class', 'chart-data')
      .datum(
        new Array(frequencies.length)
          .fill(null)
          .map((_, i) => [frequencies[i], linearToDb(frequencyResponses[i])] as [number, number])
      )
      .attr('fill', 'none')
      .attr('stroke', LINE_COLOR)
      .attr('stroke-width', 1.5)
      .attr(
        'd',
        d3
          .line()
          .x(d => this.x(d[0]))
          .y(d => y(d[1]))
      );
  }
}

const StateByVcId: Map<string, FilterDesigner> = new Map();

interface ConfigureFilterGroupProps {
  state: FilterDesignerState;
  setState: React.Dispatch<React.SetStateAction<FilterDesignerState>>;
  groupIx: number;
  inst: FilterDesigner;
  updateConnectables?: (newState?: FilterDesignerState) => void;
}

const ConfigureFilterGroup: React.FC<ConfigureFilterGroupProps> = ({
  state,
  setState,
  groupIx,
  inst,
  updateConnectables,
}) => {
  const onDelete = useCallback(
    filterIx =>
      setState((state): FilterDesignerState => {
        const group = state.filterGroups[groupIx];
        // can't delete all filters
        if (group.length === 1) {
          return state;
        }

        disconnectFilterChain(group.map(R.prop('filter')));
        const newState = {
          ...state,
          filters: group.filter((_, i) => i !== filterIx),
        };
        connectFilterChain(newState.filters.map(R.prop('filter')));
        updateConnectables?.(newState);
        return newState;
      }),
    [groupIx, setState, updateConnectables]
  );
  const onChange = useCallback(
    newState => {
      inst.onUpdated(newState);
      setState(newState);
    },
    [inst, setState]
  );

  const settings = useMemo(
    () => [
      {
        type: 'button',
        label: 'add filter',
        action: () => {
          setState(state => {
            disconnectFilterChain(state.filterGroups[groupIx].map(R.prop('filter')));
            const newFilter = new BiquadFilterNode(ctx);
            const params = buildDefaultFilter(FilterType.Lowpass, 0.74);
            setFilter(newFilter, params, state.lockedFrequencyByGroup[groupIx]);
            const newState = R.set(
              R.lensPath(['filterGroups', groupIx]),
              [
                ...state.filterGroups[groupIx],
                { filter: newFilter, params, id: btoa(Math.random().toString()) },
              ],
              state
            );
            connectFilterChain(newState.filterGroups[groupIx].map(R.prop('filter')));
            updateConnectables?.(newState);
            return newState;
          });
        },
      },
    ],
    [groupIx, setState, updateConnectables]
  );

  return (
    <div className='filter-group' key={groupIx}>
      <FilterParamsEditor
        lockedFrequency={state.lockedFrequencyByGroup[groupIx] ?? null}
        group={state.filterGroups[groupIx]}
        groupIx={groupIx}
        onChange={onChange}
        onDelete={onDelete}
      />
      <ControlPanel width={700} settings={settings} />
    </div>
  );
};

interface FilterDesignerUIProps {
  vcId: string;
  initialState: FilterDesignerState;
  onChange: (newState: FilterDesignerState) => void;
  updateConnectables?: (newState?: FilterDesignerState) => void;
}

const FilterDesignerUI: React.FC<FilterDesignerUIProps> = ({
  vcId,
  initialState,
  onChange,
  updateConnectables,
}) => {
  const containerId = useMemo(() => btoa(vcId).replace(/=/g, ''), [vcId]);
  const inst = useMemo(() => {
    const inst = StateByVcId.get(vcId);
    if (!inst) {
      const inst = new FilterDesigner(initialState, containerId);
      StateByVcId.set(vcId, inst);
      return inst;
    }
    return inst;
  }, [containerId, initialState, vcId]);
  const [state, setState] = useState(initialState);
  useEffect(() => onChange(state), [state, onChange]);
  const [selectedPresetName, setSelectedPresetName] = useState(Presets[0].name);

  useEffect(() => inst.onUpdated(state), [inst, state]);
  const topSettings = useMemo(() => {
    return filterNils([
      { type: 'multibox', label: 'lock frequency' },
      ...filterNils(
        state.lockedFrequencyByGroup.map((lockedFrequency, groupIx) =>
          R.isNil(lockedFrequency)
            ? null
            : {
                type: 'range',
                label: `group ${groupIx + 1} frequency`,
                min: 10,
                max: 44_040 / 2,
                scale: 'log',
                steps: 1000,
              }
        )
      ),
      { type: 'select', label: 'preset', options: Presets.map(R.prop('name')) },
      {
        type: 'button',
        label: 'load preset',
        action: () => {
          setState(state => {
            state.filterGroups.forEach(group => disconnectFilterChain(group.map(R.prop('filter'))));
            const { preset } = Presets.find(R.propEq('name', selectedPresetName))!;
            const newState = deserializeFilterDesigner(preset);
            updateConnectables?.(newState);
            return newState;
          });
        },
      },
    ]);
  }, [selectedPresetName, state.lockedFrequencyByGroup, updateConnectables]);
  useEffect(() => {
    state.filterGroups.forEach((group, groupIx) => {
      const lockedFrequencyForGroup = state.lockedFrequencyByGroup[groupIx];
      if (R.isNil(lockedFrequencyForGroup)) {
        return;
      }

      group.forEach(filter => {
        filter.filter.frequency.value = lockedFrequencyForGroup!;
      });
    });
  }, [state.filterGroups, state.lockedFrequencyByGroup]);

  const controlPanelState = useMemo(() => {
    const acc = {
      'lock frequency': new Array(state.filterGroups.length)
        .fill(null)
        .map((_, groupIx) => !R.isNil(state.lockedFrequencyByGroup[groupIx])),
      selectedPresetName,
    };

    return state.filterGroups.reduce((acc, group, groupIx) => {
      if (R.isNil(state.lockedFrequencyByGroup)) {
        return acc;
      }

      return { ...acc, [`group ${groupIx + 1} frequency`]: state.lockedFrequencyByGroup[groupIx] };
    }, acc);
  }, [selectedPresetName, state.filterGroups, state.lockedFrequencyByGroup]);
  const handleChange = useCallback((key: string, val: any) => {
    switch (key) {
      case 'lock frequency': {
        const newLockStatusByGroup: boolean[] = val;

        setState(state => {
          const newLockedFrequenciesByGroup = state.filterGroups.map((group, groupIx) => {
            const shouldLock = !!newLockStatusByGroup[groupIx];
            const wasLocked = !R.isNil(state.lockedFrequencyByGroup[groupIx]);

            group.forEach(filter =>
              setFilter(filter.filter, filter.params, shouldLock ? 440 : null)
            );

            if (!shouldLock) {
              return null;
            }

            return wasLocked ? state.lockedFrequencyByGroup[groupIx] : 440;
          });
          return { ...state, lockedFrequencyByGroup: newLockedFrequenciesByGroup };
        });

        break;
      }
      case 'preset': {
        setSelectedPresetName(val);
        break;
      }
      default: {
        if (key.startsWith('group ')) {
          const groupIx = +key.split(' ')[1] - 1;
          setState(state => ({
            ...state,
            lockedFrequencyByGroup: R.set(R.lensIndex(groupIx), val, state.lockedFrequencyByGroup),
          }));
          return;
        }

        console.error('Unhandled key in top settings for filter designer: ', key);
      }
    }
  }, []);

  return (
    <div className='filter-designer'>
      <div style={{ margin: 20 }}>
        <ControlPanel
          width={700}
          settings={topSettings}
          state={controlPanelState}
          onChange={handleChange}
        />
        {state.filterGroups.map((group, groupIx) => (
          <ConfigureFilterGroup
            state={state}
            setState={setState}
            inst={inst}
            groupIx={groupIx}
            key={groupIx}
            updateConnectables={updateConnectables}
          />
        ))}
      </div>

      <div style={{ width: WIDTH }} className='frequency-response-container'>
        <h2>frequency response</h2>
        <div
          ref={() => inst.onUpdated(state)}
          style={{ width: WIDTH, height: HEIGHT }}
          id={containerId}
          className='filter-designer-frequency-response-plot'
        />
      </div>
    </div>
  );
};

export default FilterDesignerUI;
