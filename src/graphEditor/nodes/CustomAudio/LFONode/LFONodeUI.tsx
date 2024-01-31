import * as R from 'ramda';
import React from 'react';
import ControlPanel, { Range, Select } from 'react-control-panel';

import type { LFOParams } from 'src/graphEditor/nodes/CustomAudio/LFONode/LFONode';

export const ALL_WAVEFORMS: OscillatorType[] = ['sine', 'triangle', 'square', 'sawtooth'];

const LFOSmallView: React.FC<{
  onChange: (params: LFOParams) => void;
  initialState: { frequency: number; waveform: OscillatorType };
}> = ({ onChange, initialState }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <ControlPanel
      style={{ width: 500 }}
      initialState={initialState}
      onChange={(
        _key: string,
        _val: number,
        {
          frequency,
          waveform,
        }: {
          frequency: number | undefined;
          waveform: OscillatorType;
        }
      ) =>
        onChange({
          frequency: R.isNil(frequency) ? initialState.frequency : frequency,
          waveform,
        })
      }
    >
      <Range label='frequency' min={0.001} max={10000} scale='log' steps={1000} />
      <Select label='waveform' options={ALL_WAVEFORMS} />
    </ControlPanel>
    <i style={{ fontSize: 14 }}>Outputs values from -1 to 1</i>
  </div>
);

export default LFOSmallView;
