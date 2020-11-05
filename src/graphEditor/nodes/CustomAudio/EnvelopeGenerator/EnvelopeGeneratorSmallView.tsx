import React from 'react';
import ControlPanel from 'react-control-panel';

import { ADSRValues, ControlPanelADSR } from 'src/controls/adsr';

const EnvelopeGeneratorSmallView: React.FC<{
  onChange: (params: ADSRValues, lengthMS: number) => void;
  initialState: { envelope: ADSRValues; lengthMS: number };
}> = ({ onChange, initialState }) => (
  <ControlPanel
    settings={[
      {
        type: 'range',
        min: 1,
        max: 100000,
        label: 'lengthMS',
        scale: 'log',
        initial: Math.max(initialState.lengthMS, 1),
      },
      {
        type: 'custom',
        label: 'adsr',
        initial: initialState.envelope,
        Comp: ControlPanelADSR,
      },
    ]}
    onChange={(_key: string, _val: any, state: any) => onChange(state.adsr, state.lengthMS)}
  />
);

export default EnvelopeGeneratorSmallView;
