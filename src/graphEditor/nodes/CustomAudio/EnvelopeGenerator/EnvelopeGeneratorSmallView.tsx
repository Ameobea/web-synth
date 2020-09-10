import React from 'react';
import ControlPanel from 'react-control-panel';

import { ADSRValues, ControlPanelADSR } from 'src/controls/adsr';

const EnvelopeGeneratorSmallView: React.FC<{
  onChange: (params: ADSRValues) => void;
  initialState: { envelope: ADSRValues };
}> = ({ onChange, initialState }) => {
  return (
    <ControlPanel
      settings={[
        {
          type: 'custom',
          label: 'adsr',
          initial: initialState.envelope,
          Comp: ControlPanelADSR,
        },
      ]}
      onChange={(key: string, val: any) => {
        switch (key) {
          case 'adsr': {
            onChange(val);
            return;
          }
          default:
            console.error('Unimplemented key in `EnvelopeGeneratorSmallView`: ', key);
        }
      }}
    />
  );
};

export default EnvelopeGeneratorSmallView;
