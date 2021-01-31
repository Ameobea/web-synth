import { ArrayElementOf } from 'ameo-utils';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DragDropContext,
  DragStart,
  DropResult,
  ResponderProvided,
  Droppable,
  Draggable,
} from 'react-beautiful-dnd';
import ControlPanel from 'react-control-panel';

import { FilterParams } from 'src/redux/modules/synthDesigner';
import { getSettingsForFilterType } from 'src/synthDesigner/filterHelpers';
import d3 from './d3';
import './FilterDesigner.scss';

export interface FilterDesignerState {
  filters: { params: FilterParams; filter: BiquadFilterNode; id: string }[];
}

const WIDTH = 800;
const HEIGHT = 350;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 20;
const MARGIN_RIGHT = 10;
const MARGIN_LEFT = 40;
const LINE_COLOR = '#008387';

const min = 10;
const max = 44_100 / 2;
const scaleValue = (x: number) =>
  Math.exp(Math.log(min) + ((Math.log(max) - Math.log(min)) * (x / 1024) * 100) / 100);
const FREQUENCIES = new Float32Array(1024).map((_, i) => scaleValue(i));

const freqResToDb = (res: number): number => (20.0 * Math.log(res)) / Math.LN10;
const setFilter = (filter: BiquadFilterNode, params: FilterParams) => {
  filter.type = params.type;
  filter.Q.value = freqResToDb(params.Q ?? 0);
  filter.frequency.value = params.frequency;
  filter.detune.value = params.detune;
  filter.gain.value = params.gain;
};

const FilterInst: React.FC<{
  filter: ArrayElementOf<FilterDesignerState['filters']>;
  onChange: (newParams: FilterParams) => void;
}> = ({ filter: { params, filter }, onChange }) => {
  const settings = useMemo(() => getSettingsForFilterType(params.type, false, false), [
    params.type,
  ]);

  return (
    <>
      <ControlPanel
        style={{ width: 500 }}
        settings={settings}
        onChange={(key: string, val: any) => {
          const newParams: FilterParams = { ...params, [key]: val };
          setFilter(filter, newParams);
          onChange(newParams);
        }}
        initialState={{
          type: params.type,
          frequency: params.frequency,
          Q: params.Q,
          detune: params.detune,
          gain: params.gain,
        }}
      />
    </>
  );
};

const FilterParamsEditor: React.FC<{
  vcId: string;
  state: FilterDesignerState;
  onChange: (newState: FilterDesignerState) => void;
}> = ({ vcId, state, onChange }) => (
  <DragDropContext
    onDragStart={(initial: DragStart, provided: ResponderProvided) => {
      // TODO
    }}
    onDragEnd={(result: DropResult, provided: ResponderProvided) => {
      // TODO
    }}
  >
    <Droppable droppableId={`filters-${vcId}`}>
      {provided => (
        <ul {...provided.droppableProps} ref={provided.innerRef}>
          {state.filters.map((filter, i) => (
            <Draggable index={i} draggableId={filter.id} key={filter.id}>
              {provided => (
                <li
                  ref={provided.innerRef}
                  {...provided.draggableProps}
                  {...provided.dragHandleProps}
                >
                  <FilterInst
                    filter={filter}
                    onChange={newParams => {
                      const newFilters = [...state.filters];
                      newFilters[i] = { ...newFilters[i], params: newParams };
                      onChange({ ...state, filters: newFilters });
                    }}
                  />
                </li>
              )}
            </Draggable>
          ))}
          {provided.placeholder}
        </ul>
      )}
    </Droppable>
  </DragDropContext>
);

class FilterDesigner {
  private state: FilterDesignerState;
  private onChange: (newState: FilterDesignerState) => void;
  private containerId: string;

  constructor(
    initialState: FilterDesignerState,
    onChange: (newState: FilterDesignerState) => void,
    containerId: string
  ) {
    this.state = initialState;
    this.onChange = onChange;
    this.containerId = containerId;

    this.onUpdated(this.state);
  }

  public onUpdated(newState: FilterDesignerState) {
    this.state = newState;
    const frequencyResponses = this.state.filters.map(({ filter }) => {
      const responses = new Float32Array(1024);
      filter.getFrequencyResponse(FREQUENCIES, responses, new Float32Array(1024));
      return responses;
    });
    const aggResponses = frequencyResponses.reduce((acc, res) => {
      acc.forEach((y, i) => {
        acc[i] = y * res[i];
      });
      return acc;
    }, new Float32Array(1024).fill(1));
    this.render(FREQUENCIES, aggResponses);

    this.onChange(this.state);
  }

  public setOnChange(newOnChange: (newState: FilterDesignerState) => void) {
    this.onChange = newOnChange;
  }

  public render(frequencies: Float32Array, frequencyResponses: Float32Array) {
    // Clear previous rendering if it exists
    const prev = document.getElementById(this.containerId);
    if (prev) {
      prev.innerHTML = '';
    }

    const maxVal = freqResToDb(frequencyResponses.reduce((acc, val) => Math.max(acc, val), 1));

    const svg = d3
      .select('#' + this.containerId)
      .append('svg')
      .attr('width', WIDTH + MARGIN_LEFT + MARGIN_RIGHT)
      .attr('height', HEIGHT + MARGIN_TOP + MARGIN_BOTTOM)
      .append('g')
      .attr('transform', `translate(${MARGIN_LEFT}, ${MARGIN_TOP})`);

    const x = d3
      .scaleLog()
      .domain([10, 44_100 / 2])
      .range([0, WIDTH]);
    svg
      .append('g')
      .attr('transform', `translate(0, ${HEIGHT})`)
      .attr('class', 'x-axis')
      .call(d3.axisBottom(x).ticks(12, ',.1s').tickSize(6));
    const y = d3.scaleLinear().domain([-100, maxVal]).range([HEIGHT, 0]);
    svg
      .append('g')
      .attr('class', 'y-axis')
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat(val => (typeof val === 'number' ? val : val.valueOf()).toFixed(2))
      );

    svg
      .append('path')
      .datum(
        new Array(frequencies.length)
          .fill(null)
          .map((_, i) => [frequencies[i], freqResToDb(frequencyResponses[i])] as [number, number])
      )
      .attr('fill', 'none')
      .attr('stroke', LINE_COLOR)
      .attr('stroke-width', 1.5)
      .attr(
        'd',
        d3
          .line()
          .x(d => x(d[0]))
          .y(d => y(d[1]))
      );
  }
}

const FilterDesignerUI: React.FC<{
  vcId: string;
  initialState: FilterDesignerState;
  onChange: (newState: FilterDesignerState) => void;
}> = ({ vcId, initialState, onChange }) => {
  const containerId = useRef(btoa(Math.random().toString()).replace(/=/g, ''));
  const inst = useRef(new FilterDesigner(initialState, onChange, containerId.current));
  const [state, setState] = useState(initialState);

  useEffect(() => {
    inst.current.setOnChange(onChange);
  }, [onChange]);
  useEffect(() => {
    inst.current.onUpdated(state);
  }, [state]);

  return (
    <div className='filter-designer'>
      <FilterParamsEditor
        vcId={vcId}
        state={state}
        onChange={newState => {
          inst.current.onUpdated(newState);
          setState(newState);
        }}
      />
      <div
        ref={() => inst.current.onUpdated(state)}
        style={{ width: WIDTH, height: HEIGHT }}
        id={containerId.current}
        className='filter-designer-frequency-response-plot'
      />
    </div>
  );
};

export default FilterDesignerUI;
