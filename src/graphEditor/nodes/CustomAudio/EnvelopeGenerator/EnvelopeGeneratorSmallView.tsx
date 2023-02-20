import React, { useCallback, useEffect, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { get, type Writable } from 'svelte/store';

import { mkControlPanelADSR2WithSize } from 'src/controls/adsr2/ControlPanelADSR2';
import type { ControlPanelSetting } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
import type { EnvelopeGeneratorState } from 'src/graphEditor/nodes/CustomAudio/EnvelopeGenerator';
import type { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import { RegateMode } from 'src/graphEditor/nodes/CustomAudio/MIDIToFrequency/MIDIToFrequencySmallView.svelte';
import { samplesToMs } from 'src/util';

interface EnvelopeGeneratorSmallViewProps {
  onChange: (params: Adsr, lengthMS: number) => void;
  setLogScale: (logScale: boolean) => void;
  setRegateMode: (regateMode: RegateMode) => void;
  store: Writable<EnvelopeGeneratorState>;
}

const settings: ControlPanelSetting[] = [
  {
    type: 'checkbox',
    label: 'log scale',
  },
  {
    type: 'range',
    min: 1,
    max: 100000,
    label: 'lengthMS',
    scale: 'log',
  },
  {
    type: 'select',
    options: {
      'on any attack': RegateMode.AnyAttack,
      'when no notes currently held': RegateMode.NoNotesHeld,
    },
    label: 'regate mode',
  },
  {
    type: 'custom',
    label: 'adsr',
    Comp: mkControlPanelADSR2WithSize(475, undefined, undefined, 'EnvelopeGeneratorSmallView'),
  },
];

const EnvelopeGeneratorSmallView: React.FC<EnvelopeGeneratorSmallViewProps> = ({
  onChange,
  setLogScale,
  setRegateMode,
  store,
}) => {
  const [state, setState] = useState(get(store));
  useEffect(() => {
    const unsubscribe = store.subscribe(newState => void setState(newState));
    return unsubscribe;
  }, [store]);

  const handleChange = useCallback(
    (key: string, val: any, state: any) => {
      if (key === 'log scale') {
        setLogScale(val);
      } else if (key === 'regate mode') {
        setRegateMode(val);
        return;
      }

      onChange({ ...state.adsr, logScale: state['log scale'] }, state.lengthMS);
    },
    [onChange, setLogScale, setRegateMode]
  );

  return (
    <ControlPanel
      settings={settings}
      width={500}
      onChange={handleChange}
      state={{
        'log scale': state.envelope.logScale ?? false,
        adsr: { ...state.envelope, outputRange: state.outputRange },
        lengthMS: samplesToMs(state.envelope.lenSamples),
        'regate mode': state.regateMode,
      }}
    />
  );
};

export default EnvelopeGeneratorSmallView;
