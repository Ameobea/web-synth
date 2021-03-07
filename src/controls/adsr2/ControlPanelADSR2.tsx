import React from 'react';

import ADSR2 from 'src/controls/adsr2/adsr2';
import type { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

export const mkControlPanelADSR2WithSize = (widthPx: number | undefined, heightPx = 350) => {
  const ControlPanelADSR2: React.FC<{
    value: Adsr & { outputRange: [number, number] };
    onChange: (newState: Adsr & { outputRange: [number, number] }) => void;
  }> = ({ value, onChange }) => {
    if (!value) {
      console.error('Missing `value` to `ControlPanelADSR2`');
    } else if (!value.outputRange) {
      console.error(
        'Invalid `value` provided to `ControlPanelADSR2; missing `outputRange`; value: ',
        value
      );
    }
    return <ADSR2 initialState={value} onChange={onChange} height={heightPx} width={widthPx} />;
  };
  return ControlPanelADSR2;
};

export const ControlPanelADSR2 = mkControlPanelADSR2WithSize(undefined);

export default ControlPanelADSR2;
