import React, { useState } from 'react';

interface ErrMsgProps {
  msg: string;
}

const ErrMsg: React.FC<ErrMsgProps> = ({ msg }) => <span style={{ color: 'red' }}>{msg}</span>;

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

    const [newMin, newMax] = [+newDisplayValue[0], +newDisplayValue[1]];
    if (Number.isNaN(newMin) || Number.isNaN(newMax)) {
      setErrMsg('Non-numerical values entered');
      return;
    } else if (newMin >= newMax) {
      setErrMsg('Invalid range');
      return;
    }

    const newRange = [newMin, newMax] as [number, number];
    onChange(newRange);
    setErrMsg(null);
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
