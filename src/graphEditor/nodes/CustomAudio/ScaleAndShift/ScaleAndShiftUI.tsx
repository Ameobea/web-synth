import React, { useCallback, useMemo, useState } from 'react';
import ReactControlPanel from 'react-control-panel';
import * as R from 'ramda';

import './RangeInput.scss';

const ErrMsg: React.FC<{ msg: string }> = ({ msg }) => <span style={{ color: 'red' }}>{msg}</span>;

interface RangeInputProps {
  onChange: (newRange: [number, number]) => void;
  value: readonly [number, number];
  theme?: any;
  containerStyle?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
}

export const RangeInput: React.FC<RangeInputProps> = ({
  value,
  onChange,
  containerStyle,
  inputStyle,
}) => {
  const [displayValue, setDisplayValue] = useState<[string, string]>(
    value.map(n => n.toString()) as [string, string]
  );

  const [errMsg, setErrMsg] = useState<string | null>(null);
  if (!value) {
    return null;
  }

  const mkRangeInputOnChangeHandler = (ix: 0 | 1) => (evt: React.ChangeEvent<HTMLInputElement>) => {
    const newDisplayValue = [...displayValue] as [string, string];
    newDisplayValue[ix] = evt.target.value;
    setDisplayValue(newDisplayValue);

    const newValue = +evt.target.value;
    if (Number.isNaN(newValue)) {
      setErrMsg('Non-numerical values entered');
      return;
    } else if ((ix === 0 && value[1] < newValue) || (ix === 1 && value[0] > newValue)) {
      setErrMsg('Invalid range');
      return;
    }

    const newRange = [...value] as [number, number];
    newRange[ix] = newValue;
    onChange(newRange);
    if (setErrMsg !== null) {
      setErrMsg(null);
    }
  };

  return (
    <div className='range-input' style={containerStyle}>
      <input
        style={inputStyle}
        type='text'
        value={displayValue[0]}
        onChange={mkRangeInputOnChangeHandler(0)}
      />
      <input
        style={inputStyle}
        type='text'
        value={displayValue[1]}
        onChange={mkRangeInputOnChangeHandler(1)}
      />

      {errMsg ? <ErrMsg msg={errMsg} /> : null}
    </div>
  );
};

const style = { width: 500 };

interface ScaleAndShiftSmallViewProps {
  initialState: ScaleAndShiftUIState;
  onChange: (newState: ScaleAndShiftUIState) => void;
}

export interface ScaleAndShiftUIState {
  input_min_max: readonly [number, number];
  output_min_max: readonly [number, number];
  input_range: readonly [number, number];
  output_range: readonly [number, number];
}

const ScaleAndShiftSmallView: React.FC<ScaleAndShiftSmallViewProps> = ({
  initialState,
  onChange,
}) => {
  const [state, setState] = useState(initialState);

  const handleChange = useCallback(
    (_key: string, _val: any, baseNewState: ScaleAndShiftUIState) => {
      const newState = { ...state };
      Object.entries(baseNewState).forEach(([key, val]) => {
        if (val) {
          newState[key as keyof typeof newState] = val;
        }
      });

      const clampedNewState = {
        ...newState,
        input_range: [
          R.clamp(
            newState.input_min_max[0],
            Math.min(newState.input_min_max[1], newState.input_range[1]),
            newState.input_range[0]
          ),
          R.clamp(
            Math.max(newState.input_min_max[0], newState.input_range[0]),
            newState.input_min_max[1],
            newState.input_range[1]
          ),
        ] as const,
        output_range: [
          R.clamp(
            newState.output_min_max[0],
            Math.min(newState.output_min_max[1], newState.output_range[1]),
            newState.output_range[0]
          ),
          R.clamp(
            Math.max(newState.output_min_max[0], newState.output_range[0]),
            newState.output_min_max[1],
            newState.output_range[1]
          ),
        ] as const,
      };

      onChange(clampedNewState);
      setState(clampedNewState);
    },
    [onChange, state]
  );
  const settings = useMemo(
    () => [
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
      // TODO: Add support for transforming to/from linear/log and possibly other scales
    ],
    [state.input_min_max, state.output_min_max]
  );

  return (
    <ReactControlPanel state={state} onChange={handleChange} style={style} settings={settings} />
  );
};

export default ScaleAndShiftSmallView;
