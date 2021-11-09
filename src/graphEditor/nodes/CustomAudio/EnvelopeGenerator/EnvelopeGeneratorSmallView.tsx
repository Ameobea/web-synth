import React, { useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import { mkControlPanelADSR2WithSize } from 'src/controls/adsr2/ControlPanelADSR2';
import { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

interface EnvelopeGeneratorSmallViewProps {
  onChange: (params: Adsr, lengthMS: number) => void;
  setLogScale: (logScale: boolean) => void;
  initialState: { envelope: Adsr & { outputRange: [number, number] }; lengthMS: number };
}

const EnvelopeGeneratorSmallView: React.FC<EnvelopeGeneratorSmallViewProps> = ({
  onChange,
  setLogScale,
  initialState,
}) => {
  const settings = useMemo(
    () => [
      {
        type: 'checkbox',
        label: 'log scale',
        initial: initialState.envelope.logScale ?? false,
      },
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
        Comp: mkControlPanelADSR2WithSize(475),
      },
    ],
    [initialState.envelope, initialState.lengthMS]
  );

  const handleChange = useCallback(
    (key: string, val: any, state: any) => {
      if (key === 'log scale') {
        setLogScale(val);
        return;
      }

      onChange({ ...state.adsr, logScale: state['log scale'] }, state.lengthMS);
    },
    [onChange, setLogScale]
  );

  return <ControlPanel settings={settings} width={500} onChange={handleChange} />;
};

export default EnvelopeGeneratorSmallView;
