import React, { useState } from 'react';
import ReactControlPanel, { Custom } from 'react-control-panel';

const ErrMsg: React.FC<{ msg: string }> = ({ msg }) => <span style={{ color: 'red' }}>{msg}</span>;

const RangeInput: React.FC<{
  onChange: (newRange: [number, number]) => void;
  value: [number, number];
  theme: any;
}> = ({ value, onChange }) => {
  const [errMsg, setErrMsg] = useState<string | null>(null);
  if (!value) {
    return null;
  }

  const mkRangeInputInput = (ix: 0 | 1) => (evt: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = +evt.target.value;
    if (Number.isNaN(newValue)) {
      setErrMsg('Non-numerical values entered');
      return;
    } else if ((ix === 0 && value[1] < ix) || (ix === 1 && value[0] > ix)) {
      setErrMsg('Invalid range');
      return;
    }

    const newRange = [...value] as [number, number];
    newRange[ix] = newValue;
    onChange(newRange);
  };

  return (
    <div>
      <input type='text' value={value[0]} onChange={mkRangeInputInput(0)} />
      <input type='text' value={value[1]} onChange={mkRangeInputInput(1)} />

      {errMsg ? <ErrMsg msg={errMsg} /> : null}
    </div>
  );
};

export interface ScaleAndShiftUIState {
  input_range: [number, number];
  output_range: [number, number];
}

const ScaleAndShiftSmallView: React.FC<{
  initialState: ScaleAndShiftUIState;
  onChange: (newState: ScaleAndShiftUIState) => void;
}> = ({ initialState, onChange }) => (
  <ReactControlPanel
    initialState={initialState}
    onChange={(_key: string, _val: any, newState: ScaleAndShiftUIState) => onChange(newState)}
  >
    <Custom label='input_range' initial={initialState.input_range} Comp={RangeInput} />
    <Custom label='output_range' initial={initialState.output_range} Comp={RangeInput} />
    {/* TODO: Add support for transforming to/from linear/log and possibly other scales */}
  </ReactControlPanel>
);

export default ScaleAndShiftSmallView;
