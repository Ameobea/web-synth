import * as R from 'ramda';
import React, { useCallback, useMemo, useState } from 'react';
import ReactControlPanel from 'react-control-panel';

import './RangeInput.css';
import type { ControlPanelSetting } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
import type { Writable } from 'svelte/store';
import ResponsePlotSvelte from './ResponsePlot.svelte';
import { mkSvelteComponentShim } from 'src/svelteUtils';
import { RangeInput } from 'src/graphEditor/nodes/CustomAudio/ScaleAndShift/RangeInput';

const ResponsePlot = mkSvelteComponentShim(ResponsePlotSvelte);

const style = { width: 500 };

export interface LinearToExponentialState {
  enabled: boolean;
  direction: 'linearToExponential' | 'exponentialToLinear';
  /**
   * This represents the ratio between the min and max values of the intermediate output range.
   *
   * So if we wanted to map a linear control value from a slider or similar to a frequency value
   * for a filter cutoff, for example, a steepness value of (44_100 / 2) / 20 could be appropriate.
   */
  steepness: number;
}

const buildDefaultLinearToExponentialState = (enabled = false): LinearToExponentialState => ({
  enabled,
  direction: 'linearToExponential',
  steepness: 44_100 / 2 / 20,
});

export interface ScaleAndShiftUIState {
  input_min_max: readonly [number, number];
  output_min_max: readonly [number, number];
  input_range: readonly [number, number];
  output_range: readonly [number, number];
  linearToExponentialState?: LinearToExponentialState;
}

interface ConfigureLinearToExponentialProps {
  state: LinearToExponentialState;
  onChange: (newState: LinearToExponentialState) => void;
}

const ConfigureLinearToExponential: React.FC<ConfigureLinearToExponentialProps> = ({
  state,
  onChange,
}) => {
  const handleChange = useCallback(
    (key: keyof LinearToExponentialState, val: any) => {
      const newState: LinearToExponentialState = { ...state };
      (newState as any)[key] = val;
      onChange(newState);
    },
    [onChange, state]
  );

  const settings = useMemo(
    (): ControlPanelSetting[] => [
      {
        label: 'direction',
        type: 'select',
        options: ['linearToExponential', 'exponentialToLinear'],
      },
      {
        label: 'steepness',
        type: 'range',
        min: 1.1,
        max: 100_000,
        scale: 'log',
      },
    ],
    []
  );

  return (
    <ReactControlPanel state={state} onChange={handleChange} settings={settings} style={style} />
  );
};

export interface ResponsePlotData {
  input: Float32Array;
  output: Float32Array;
}

export interface ScaleAndShiftSmallViewProps {
  initialState: ScaleAndShiftUIState;
  onChange: (newState: ScaleAndShiftUIState) => void;
  responsePlot: Writable<ResponsePlotData | null>;
}

const ScaleAndShiftSmallView: React.FC<ScaleAndShiftSmallViewProps> = ({
  initialState,
  onChange,
  responsePlot,
}) => {
  const [state, setState] = useState(initialState);

  const handleChange = useCallback(
    (key: string, val: any, baseNewState: ScaleAndShiftUIState) => {
      let newState = { ...state };

      if (key === 'convert linear/exponential') {
        if (state.linearToExponentialState) {
          newState = {
            ...state,
            linearToExponentialState: { ...state.linearToExponentialState, enabled: !!val },
          };
        } else {
          newState = {
            ...state,
            linearToExponentialState: buildDefaultLinearToExponentialState(!!val),
          };
        }

        onChange(newState);
        setState(newState);
        return;
      }

      Object.entries(baseNewState).forEach(([key, val]) => {
        if (val) {
          newState[key as keyof typeof newState] = val;
        }
      });

      const clampedNewState = {
        ...newState,
        input_range: [
          R.clamp(newState.input_min_max[0], newState.input_min_max[1], newState.input_range[0]),
          R.clamp(newState.input_min_max[0], newState.input_min_max[1], newState.input_range[1]),
        ] as const,
        output_range: [
          R.clamp(newState.output_min_max[0], newState.output_min_max[1], newState.output_range[0]),
          R.clamp(newState.output_min_max[0], newState.output_min_max[1], newState.output_range[1]),
        ] as const,
      };

      onChange(clampedNewState);
      setState(clampedNewState);
    },
    [onChange, state]
  );
  const handleLinearExponentialChange = useCallback(
    (newLinearToExponentialState: LinearToExponentialState) => {
      const newState = { ...state, linearToExponentialState: newLinearToExponentialState };
      onChange(newState);
      setState(newState);
    },
    [onChange, state]
  );
  const settings = useMemo(
    (): ControlPanelSetting[] => [
      { label: 'input_min_max', type: 'custom', Comp: RangeInput },
      { label: 'output_min_max', type: 'custom', Comp: RangeInput },
      {
        label: 'input_range',
        type: 'interval',
        min: state.input_min_max[0],
        max: state.input_min_max[1],
      },
      {
        label: 'output_range',
        type: 'interval',
        min: state.output_min_max[0],
        max: state.output_min_max[1],
      },
      {
        label: 'convert linear/exponential',
        type: 'checkbox',
      },
    ],
    [state.input_min_max, state.output_min_max]
  );
  const controlPanelState = useMemo(
    () => ({
      ...state,
      'convert linear/exponential': !!state.linearToExponentialState?.enabled,
    }),
    [state]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <ReactControlPanel
        state={controlPanelState}
        onChange={handleChange}
        style={style}
        settings={settings}
      />
      {state.linearToExponentialState?.enabled ? (
        <>
          <ConfigureLinearToExponential
            state={state.linearToExponentialState}
            onChange={handleLinearExponentialChange}
          />
          <ResponsePlot responsePlot={responsePlot} />
        </>
      ) : null}
    </div>
  );
};

export default ScaleAndShiftSmallView;
