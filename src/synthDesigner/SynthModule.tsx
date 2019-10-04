import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import { SynthModule, Waveform } from 'src/redux/modules/synthDesigner';
import { dispatch, actionCreators } from 'src/redux';
import FilterModule from './Filter';

const SYNTH_SETTINGS = [
  {
    type: 'range',
    label: 'volume',
    min: 0,
    initial: 0.1,
    max: 4,
    step: 0.05,
  },
  {
    type: 'select',
    label: 'waveform',
    options: Object.values(Waveform),
    initial: Waveform.Sine,
  },
  {
    type: 'range',
    label: 'unison',
    min: 1,
    initial: 1,
    max: 32,
    step: 1,
  },
  {
    type: 'range',
    label: 'detune',
    min: -300,
    initial: 0,
    max: 300,
    step: 0.5,
  },
];

const SynthModuleComp: React.FC<{ index: number; synth: SynthModule }> = ({
  index,
  synth,
  children,
}) => {
  return (
    <div className='synth-module'>
      <div
        className='synth-remove-button'
        onClick={() => dispatch(actionCreators.synthDesigner.DELETE_SYNTH_MODULE(index))}
      >
        X
      </div>

      <ControlPanel
        title='SYNTH'
        settings={SYNTH_SETTINGS}
        onChange={(key: string, val: any) => {
          switch (key) {
            case 'waveform': {
              dispatch(actionCreators.synthDesigner.SET_WAVEFORM(index, val));
              break;
            }
            case 'unison': {
              dispatch(actionCreators.synthDesigner.SET_UNISON(index, val));
              break;
            }
            case 'volume': {
              dispatch(actionCreators.synthDesigner.SET_SYNTH_MASTER_GAIN(index, val));
              break;
            }
            case 'detune': {
              dispatch(actionCreators.synthDesigner.SET_DETUNE(val, index));
              break;
            }
            default: {
              console.warn('Unhandled key in synth control panel: ', key);
            }
          }
        }}
        state={useMemo(
          () => ({
            waveform: synth.waveform,
            volume: synth.masterGain,
            unison: synth.oscillators.length,
            detune: synth.detune,
          }),
          [synth.waveform, synth.oscillators.length, synth.masterGain, synth.detune]
        )}
      />

      <FilterModule synthIx={index} params={synth.filter.params} />

      <div className='effects'>{children}</div>
    </div>
  );
};

export default SynthModuleComp;
