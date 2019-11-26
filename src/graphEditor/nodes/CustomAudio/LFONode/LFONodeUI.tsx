import React from 'react';
import ControlPanel, { Range } from 'react-control-panel';
import * as R from 'ramda';

const LFOSmallView: React.FC<{
  onChange: (frequency: number, gain: number, offset: number) => void;
  initialState: { frequency: number; gain: number; offset: number };
}> = ({ onChange, initialState }) => (
  <ControlPanel
    style={{ width: 500 }}
    initialState={initialState}
    onChange={(
      _key: string,
      _val: number,
      {
        frequency,
        gain,
        offset,
      }: { frequency: number | undefined; gain: number | undefined; offset: number | undefined }
    ) =>
      onChange(
        R.isNil(frequency) ? initialState.frequency : frequency,
        R.isNil(gain) ? initialState.gain : gain,
        R.isNil(offset) ? initialState.offset : offset
      )
    }
  >
    <Range label='frequency' min={0.001} max={10000} scale='log' steps={1000} />
    <Range label='gain' min={-1} max={50000} steps={5000} />
    <Range label='offset' min={-50000} max={50000} step={1} />
  </ControlPanel>
);

export default LFOSmallView;
