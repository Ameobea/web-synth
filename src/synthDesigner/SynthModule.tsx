import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import { SynthModule, Waveform } from 'src/redux/modules/synthDesigner';
import { dispatch, actionCreators } from 'src/redux';
import FilterModule from './Filter';
import { defaultAdsrEnvelope, ControlPanelADSR } from 'src/controls/adsr';

const SYNTH_SETTINGS = [
  {
    type: 'range',
    label: 'volume',
    min: 0,
    initial: 0.1,
    max: 1,
    step: 0.008,
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
  {
    type: 'custom',
    label: 'adsr',
    initial: defaultAdsrEnvelope,
    Comp: ControlPanelADSR,
  },
];

const SynthModuleComp: React.FC<{ index: number; synth: SynthModule }> = ({
  index,
  synth,
  children,
}) => {
  const unison = synth.voices[0].oscillators.length;

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
            case 'adsr': {
              dispatch(actionCreators.synthDesigner.SET_GAIN_ADSR(val, index));
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
            unison,
            detune: synth.detune,
            adsr: synth.gainEnvelope,
          }),
          // eslint-disable-next-line react-hooks/exhaustive-deps
          [synth.waveform, unison, synth.masterGain, synth.detune, synth.gainEnvelope]
        )}
        style={{ width: 378 }}
      />

      <FilterModule
        synthIx={index}
        params={synth.filterParams}
        filterEnvelope={synth.filterEnvelope}
      />

      <div className='effects'>{children}</div>
    </div>
  );
};

export default SynthModuleComp;
