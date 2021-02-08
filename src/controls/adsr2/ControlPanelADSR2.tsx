import React from 'react';

import ADSR2 from 'src/controls/adsr2/adsr2';
import type { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

const ControlPanelADSR2: React.FC<{
  state: Adsr;
  onChange: (newState: Adsr) => void;
  outputRange: [number, number];
}> = ({ state, onChange, outputRange }) => {
  return <ADSR2 initialState={state} onChange={onChange} outputRange={outputRange} />;
};

export default ControlPanelADSR2;
