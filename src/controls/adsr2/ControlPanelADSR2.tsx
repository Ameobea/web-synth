import React from 'react';

import ADSR2 from 'src/controls/adsr2/adsr2';
import type { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

export interface ADSRWithOutputRange extends Adsr {
  outputRange: readonly [number, number];
}

interface ControlPanelADSR2Props {
  value: ADSRWithOutputRange;
  onChange: (newState: ADSRWithOutputRange) => void;
}

export const mkControlPanelADSR2WithSize = (
  widthPx: number | undefined,
  heightPx = 350,
  vcId?: string,
  debugName?: string
) => {
  if (!debugName) {
    console.trace('Missing `debugName` for `mkControlPanelADSR2WithSize`');
  }

  const ControlPanelADSR2: React.FC<ControlPanelADSR2Props> = ({ value, onChange }) => {
    if (!value) {
      console.error('Missing `value` to `ControlPanelADSR2`');
    } else if (!value.outputRange) {
      console.error(
        'Invalid `value` provided to `ControlPanelADSR2; missing `outputRange`; value: ',
        value
      );
    }

    return (
      <ADSR2
        initialState={value}
        onChange={onChange}
        height={heightPx}
        width={widthPx}
        vcId={vcId}
        debugName={debugName}
      />
    );
  };
  return ControlPanelADSR2;
};
