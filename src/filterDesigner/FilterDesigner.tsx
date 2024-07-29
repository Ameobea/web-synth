import type { ScaleLogarithmic, Selection } from 'd3';
import * as R from 'ramda';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';

import d3 from './d3';
import './FilterDesigner.css';
import {
  connectFilterChain,
  deserializeFilterDesigner,
  disconnectFilterChain,
  setFilter,
  type FilterDescriptor,
  type FilterDesignerState,
  type FilterGroup,
} from 'src/filterDesigner/util';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import FlatButton from 'src/misc/FlatButton';
import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { getSettingsForFilterType } from 'src/synthDesigner/filterHelpers';
import { filterNils, linearToDb } from 'src/util';
import buildPresets from './presets';
import { FilterType } from 'src/synthDesigner/FilterType';
import { buildDefaultFilter } from 'src/synthDesigner/filterHelpersLight';

const Presets = buildPresets();

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
  frequencyLocked: boolean;
  getLockedFrequency: () => number | null;
  filter: FilterDescriptor;
  onChange: (groupIx: number, filterIx: number, newParams: FilterParams) => void;
  onDelete: (filterIx: number) => void;
}

const FilterInstInner: React.FC<FilterInstProps> = ({
  groupIx,
  filterIx,
  frequencyLocked,
  getLockedFrequency,
  filter: { params, filter, oaps },
  onChange,
  onDelete,
}) => {
  const settings = useMemo(() => {
    const settings = getSettingsForFilterType({
      filterType: params.type,
      includeADSR: false,
      includeBypass: false,
      includeNonPrimitiveFilterTypes: false,
    });
    return frequencyLocked ? settings.filter(setting => setting.label !== 'frequency') : settings;
  }, [params.type, frequencyLocked]);
  const state = useMemo(
    () => ({
      type: params.type,
      frequency: params.frequency,
      Q: params.Q,
      gain: params.gain,
    }),
    [params.Q, params.frequency, params.gain, params.type]
  );
  const handleChange = useCallback(
    (key: string, val: any) => {
      const newParams: FilterParams = { ...params, [key]: val };
      setFilter(filter, oaps, newParams, getLockedFrequency());
      onChange(groupIx, filterIx, newParams);
    },
    [filter, oaps, groupIx, filterIx, getLockedFrequency, onChange, params]
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
  frequencyLocked: boolean;
  getLockedFrequency: () => number | null;
  group: FilterGroup;
  groupIx: number;
  onChange: (mapState: (state: FilterDesignerState) => FilterDesignerState) => void;
  onDelete: (filterIx: number) => void;
}

const FilterParamsEditorInner: React.FC<FilterParamsEditorProps> = ({
  frequencyLocked,
  getLockedFrequency,
  group,
  groupIx,
  onChange,
  onDelete,
}) => {
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
          frequencyLocked={frequencyLocked}
          getLockedFrequency={getLockedFrequency}
          filter={filter}
          onChange={onInstChange}
        />
      ))}
    </div>
  );
};

const FilterParamsEditor = React.memo(FilterParamsEditorInner);

const ScratchFilter = ctx.createBiquadFilter();

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
      group.map(({ filter, oaps }) => {
        const responses = new Float32Array(DATA_SIZE);
        ScratchFilter.frequency.value = oaps.frequency.manualControl.offset.value;
        ScratchFilter.Q.value = oaps.Q.manualControl.offset.value;
        ScratchFilter.gain.value = oaps.gain.manualControl.offset.value;
        ScratchFilter.type = filter.type;
        ScratchFilter.getFrequencyResponse(FREQUENCIES, responses, new Float32Array(DATA_SIZE));
        return responses;
      })
    );
    // Filters within each group are applied in series
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
  const staticLockedFrequency = useRef(R.clone(state.lockedFrequencyByGroup));
  useEffect(() => {
    staticLockedFrequency.current = R.clone(state.lockedFrequencyByGroup);
  }, [state.lockedFrequencyByGroup]);

  const onDelete = useCallback(
    (filterIx: number) =>
      setState((state): FilterDesignerState => {
        const group = state.filterGroups[groupIx];
        // can't delete all filters
        if (group.length === 1) {
          return state;
        }

        disconnectFilterChain(group.map(g => g.filter));
        const newState = {
          ...state,
          filterGroups: R.set(
            R.lensIndex(groupIx),
            R.remove(filterIx, 1, group),
            state.filterGroups
          ),
        };
        connectFilterChain(newState.filterGroups[groupIx].map(g => g.filter));
        updateConnectables?.(newState);
        return newState;
      }),
    [groupIx, setState, updateConnectables]
  );
  const onChange = useCallback(
    (newState: FilterDesignerState | ((oldState: FilterDesignerState) => FilterDesignerState)) => {
      inst.onUpdated(newState);
      setState(newState);
    },
    [inst, setState]
  );

  const settings = useMemo(() => {
    const buildAndSetDefaultFilter = (state: FilterDesignerState) => {
      const newFilter = new BiquadFilterNode(ctx);
      const params = buildDefaultFilter(FilterType.Lowpass, 0.74);
      const oaps = {
        frequency: new OverridableAudioParam(ctx, newFilter.frequency, undefined, true),
        Q: new OverridableAudioParam(ctx, newFilter.Q, undefined, true),
        gain: new OverridableAudioParam(ctx, newFilter.gain, undefined, true),
      };
      setFilter(newFilter, oaps, params, state.lockedFrequencyByGroup[groupIx]);
      return { newFilter, params, oaps };
    };

    return [
      {
        type: 'button',
        label: 'add filter',
        action: () => {
          setState(state => {
            disconnectFilterChain(state.filterGroups[groupIx].map(g => g.filter));
            const { newFilter, params, oaps } = buildAndSetDefaultFilter(state);
            const newState = R.set(
              R.lensPath(['filterGroups', groupIx]),
              [
                ...state.filterGroups[groupIx],
                { filter: newFilter, params, id: btoa(Math.random().toString()), oaps },
              ],
              state
            );
            connectFilterChain(newState.filterGroups[groupIx].map(g => g.filter));
            updateConnectables?.(newState);
            return newState;
          });
        },
      },
      {
        type: 'button',
        label: 'add filter group',
        action: () => {
          setState(state => {
            const { newFilter, params, oaps } = buildAndSetDefaultFilter(state);
            const newState = {
              ...state,
              filterGroups: [
                ...state.filterGroups,
                [{ filter: newFilter, params, id: btoa(Math.random().toString()), oaps }],
              ],
            };
            connectFilterChain(newState.filterGroups[groupIx].map(g => g.filter));
            updateConnectables?.(newState);
            return newState;
          });
        },
      },
    ];
  }, [groupIx, setState, updateConnectables]);

  // Locked frequency isn't actually depended upon by the individual filter instances' UIs, but its value is needed
  // when toggling params so we pass through a static function that gets the current value to avoid re-rendering
  // all filter instances every time locked frequency changes
  const getLockedFrequency = useCallback(
    () => staticLockedFrequency.current[groupIx] ?? null,
    [groupIx]
  );

  return (
    <div className='filter-group' key={groupIx}>
      <FilterParamsEditor
        frequencyLocked={!R.isNil(state.lockedFrequencyByGroup[groupIx])}
        getLockedFrequency={getLockedFrequency}
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
            state.filterGroups.forEach(group => disconnectFilterChain(group.map(g => g.filter)));
            const { preset } = Presets.find(R.propEq(selectedPresetName, 'name'))!;
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
  const handleChange = useCallback((key: string, val: any, _state: typeof controlPanelState) => {
    switch (key) {
      case 'lock frequency': {
        const newLockStatusByGroup: boolean[] = val;

        setState(state => {
          const newLockedFrequenciesByGroup = state.filterGroups.map((group, groupIx) => {
            const shouldLock = !!newLockStatusByGroup[groupIx];
            const wasLocked = !R.isNil(state.lockedFrequencyByGroup[groupIx]);

            group.forEach(filter =>
              setFilter(filter.filter, filter.oaps, filter.params, shouldLock ? 440 : null)
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
          setState(state => {
            const newState = {
              ...state,
              lockedFrequencyByGroup: R.set(
                R.lensIndex(groupIx),
                val,
                state.lockedFrequencyByGroup
              ),
            };

            const group = newState.filterGroups[groupIx];
            group.forEach(filter => setFilter(filter.filter, filter.oaps, filter.params, val));

            return newState;
          });
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
