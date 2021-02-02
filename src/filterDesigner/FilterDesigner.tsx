import { ArrayElementOf, filterNils } from 'ameo-utils';
import type { ScaleLogarithmic, Selection } from 'd3';
import React, { useEffect, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';
import * as R from 'ramda';

import { FilterParams } from 'src/redux/modules/synthDesigner';
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
  FilterDesignerState,
  SerializedFilterDesigner,
  setFilter,
} from 'src/filterDesigner/util';
import { computeHigherOrderBiquadQFactors } from 'src/synthDesigner/biquadFilterModule';

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

const Presets: { name: string; preset: SerializedFilterDesigner }[] = [
  {
    name: 'init',
    preset: {
      filters: [buildDefaultFilter(FilterType.Lowpass, computeHigherOrderBiquadQFactors(2)[0])],
      lockedFrequency: null,
    },
  },
  {
    name: 'order 4 LP',
    preset: {
      filters: computeHigherOrderBiquadQFactors(4).map(q =>
        buildDefaultFilter(FilterType.Lowpass, q)
      ),
      lockedFrequency: 440,
    },
  },
  {
    name: 'order 8 LP',
    preset: {
      filters: computeHigherOrderBiquadQFactors(8).map(q =>
        buildDefaultFilter(FilterType.Lowpass, q)
      ),
      lockedFrequency: 440,
    },
  },
  {
    name: 'order 16 LP',
    preset: {
      filters: computeHigherOrderBiquadQFactors(16).map(q =>
        buildDefaultFilter(FilterType.Lowpass, q)
      ),
      lockedFrequency: 440,
    },
  },
  {
    name: 'order 4 HP',
    preset: {
      filters: computeHigherOrderBiquadQFactors(4).map(q =>
        buildDefaultFilter(FilterType.Highpass, q)
      ),
      lockedFrequency: 440,
    },
  },
  {
    name: 'order 8 HP',
    preset: {
      filters: computeHigherOrderBiquadQFactors(8).map(q =>
        buildDefaultFilter(FilterType.Highpass, q)
      ),
      lockedFrequency: 440,
    },
  },
  {
    name: 'order 16 HP',
    preset: {
      filters: computeHigherOrderBiquadQFactors(16).map(q =>
        buildDefaultFilter(FilterType.Highpass, q)
      ),
      lockedFrequency: 440,
    },
  },
];

const FilterInst: React.FC<{
  lockedFrequency: number | null;
  filter: ArrayElementOf<FilterDesignerState['filters']>;
  onChange: (newParams: FilterParams) => void;
  onDelete: () => void;
}> = ({ lockedFrequency, filter: { params, filter }, onChange, onDelete }) => {
  const settings = useMemo(() => {
    const settings = getSettingsForFilterType(params.type, false, false);
    return !R.isNil(lockedFrequency)
      ? settings.filter(setting => setting.label !== 'frequency')
      : settings;
  }, [params.type, lockedFrequency]);

  return (
    <div className='filter-inst'>
      <FlatButton onClick={onDelete}>×</FlatButton>
      <ControlPanel
        style={{ width: 500 }}
        settings={settings}
        onChange={(key: string, val: any) => {
          const newParams: FilterParams = { ...params, [key]: val };
          setFilter(filter, newParams, lockedFrequency);
          onChange(newParams);
        }}
        state={{
          type: params.type,
          frequency: params.frequency,
          Q: params.Q,
          detune: params.detune,
          gain: params.gain,
        }}
      />
    </div>
  );
};

const FilterParamsEditor: React.FC<{
  lockedFrequency: number | null;
  state: FilterDesignerState;
  onChange: (newState: FilterDesignerState) => void;
  onDelete: (filterIx: number) => void;
}> = ({ lockedFrequency, state, onChange, onDelete }) => (
  <div className='filter-params'>
    {state.filters.map((filter, i) => (
      <FilterInst
        onDelete={() => onDelete(i)}
        key={filter.id}
        lockedFrequency={lockedFrequency}
        filter={filter}
        onChange={newParams => {
          const newFilters = [...state.filters];
          newFilters[i] = { ...newFilters[i], params: newParams };
          onChange({ ...state, filters: newFilters });
        }}
      />
    ))}
  </div>
);

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

  public onUpdated(newState: FilterDesignerState) {
    this.state = newState;
    const frequencyResponses = this.state.filters.map(({ filter }) => {
      const responses = new Float32Array(DATA_SIZE);
      filter.getFrequencyResponse(FREQUENCIES, responses, new Float32Array(DATA_SIZE));
      return responses;
    });
    const aggResponses = frequencyResponses.reduce((acc, res) => {
      acc.forEach((y, i) => {
        const val = Number.isNaN(res[i]) ? 0 : res[i];
        acc[i] = y * val;
      });
      return acc;
    }, new Float32Array(DATA_SIZE).fill(1));
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

const FilterDesignerUI: React.FC<{
  vcId: string;
  initialState: FilterDesignerState;
  onChange: (newState: FilterDesignerState) => void;
  updateConnectables?: (newState?: FilterDesignerState) => void;
}> = ({ vcId, initialState, onChange, updateConnectables }) => {
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
      { type: 'checkbox', label: 'lock frequency' },
      R.isNil(state.lockedFrequency)
        ? null
        : { type: 'range', label: 'frequency', min: 10, max: 44_040 / 2, scale: 'log' },
      { type: 'select', label: 'preset', options: Presets.map(R.prop('name')) },
      {
        type: 'button',
        label: 'load preset',
        action: () => {
          disconnectFilterChain(state.filters.map(R.prop('filter')));
          const { preset } = Presets.find(R.propEq('name', selectedPresetName))!;
          const newState = deserializeFilterDesigner(preset);
          connectFilterChain(newState.filters.map(R.prop('filter')));
          setState(newState);
          updateConnectables?.(newState);
        },
      },
    ]);
  }, [selectedPresetName, state.filters, state.lockedFrequency, updateConnectables]);
  useEffect(() => {
    if (R.isNil(state.lockedFrequency)) {
      return;
    }

    state.filters.forEach(filter => {
      filter.filter.frequency.value = state.lockedFrequency!;
    });
  }, [state.lockedFrequency, state.filters]);

  return (
    <div className='filter-designer'>
      <div style={{ margin: 20 }}>
        <ControlPanel
          style={{ width: 500, marginBottom: 14 }}
          settings={topSettings}
          state={{
            'lock frequency': !R.isNil(state.lockedFrequency),
            frequency: state.lockedFrequency,
            selectedPresetName,
          }}
          onChange={(key: string, val: any) => {
            switch (key) {
              case 'lock frequency': {
                setState({ ...state, lockedFrequency: val ? 440 : null });
                state.filters.forEach(filter =>
                  setFilter(filter.filter, filter.params, val ? 440 : null)
                );
                break;
              }
              case 'frequency': {
                setState({ ...state, lockedFrequency: val });
                state.filters.forEach(filter => setFilter(filter.filter, filter.params, val));
                break;
              }
              case 'preset': {
                setSelectedPresetName(val);
                break;
              }
              default: {
                console.error('Unhandled key in top settings for filter designer: ', key);
              }
            }
          }}
        />
        <FilterParamsEditor
          lockedFrequency={state.lockedFrequency}
          state={state}
          onChange={newState => {
            inst.onUpdated(newState);
            setState(newState);
          }}
          onDelete={filterIx => {
            // can't delete all filters
            if (state.filters.length === 1) {
              return;
            }

            disconnectFilterChain(state.filters.map(R.prop('filter')));
            const newState = { ...state, filters: state.filters.filter((_, i) => i !== filterIx) };
            connectFilterChain(newState.filters.map(R.prop('filter')));
            setState(newState);
            updateConnectables?.(newState);
          }}
        />
        <ControlPanel
          style={{ width: 500 }}
          settings={[
            {
              type: 'button',
              label: 'add filter',
              action: () => {
                disconnectFilterChain(state.filters.map(R.prop('filter')));
                const newFilter = new BiquadFilterNode(ctx);
                const params = buildDefaultFilter(FilterType.Lowpass, 0.74);
                setFilter(newFilter, params, state.lockedFrequency);
                const newState = {
                  ...state,
                  filters: [
                    ...state.filters,
                    { filter: newFilter, params, id: btoa(Math.random().toString()) },
                  ],
                };
                connectFilterChain(newState.filters.map(R.prop('filter')));
                setState(newState);
                updateConnectables?.(newState);
              },
            },
          ]}
        />
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
