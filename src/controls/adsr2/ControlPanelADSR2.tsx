import React from 'react';

import ADSR2 from 'src/controls/adsr2/adsr2';
import type { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

const ControlPanelADSR2: React.FC<{
  value: Adsr & { outputRange: [number, number] };
  onChange: (newState: Adsr & { outputRange: [number, number] }) => void;
}> = ({ value, onChange }) => {
  if (!value) {
    console.error('Missing `value` to `ControlPanelADSR2`');
  }
  return <ADSR2 initialState={value} onChange={onChange} height={350} />;
};

export default ControlPanelADSR2;
