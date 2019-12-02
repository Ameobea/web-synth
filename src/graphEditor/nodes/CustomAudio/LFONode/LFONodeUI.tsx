import React from 'react';
import ControlPanel, { Range, Select } from 'react-control-panel';
import * as R from 'ramda';

import { LFOParams } from 'src/graphEditor/nodes/CustomAudio/LFONode/LFONode';

export const ALL_WAVEFORMS: OscillatorType[] = ['sine', 'triangle', 'square', 'sawtooth'];

const LFOSmallView: React.FC<{
  onChange: (params: LFOParams) => void;
  initialState: { frequency: number; gain: number; offset: number; waveform: OscillatorType };
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
        waveform,
      }: {
        frequency: number | undefined;
        gain: number | undefined;
        offset: number | undefined;
        waveform: OscillatorType;
      }
    ) =>
      onChange({
        frequency: R.isNil(frequency) ? initialState.frequency : frequency,
        gain: R.isNil(gain) ? initialState.gain : gain,
        offset: R.isNil(offset) ? initialState.offset : offset,
        waveform,
      })
    }
  >
    <Range label='frequency' min={0.001} max={10000} scale='log' steps={1000} />
    <Range label='gain' min={-1} max={50000} steps={5000} />
    <Range label='offset' min={-50000} max={50000} step={1} />
    <Select label='waveform' options={ALL_WAVEFORMS} />
  </ControlPanel>
);

export default LFOSmallView;
