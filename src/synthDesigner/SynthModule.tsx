import * as R from 'ramda';
import React, { useMemo, useRef } from 'react';
import { connect, Provider } from 'react-redux';
import ControlPanel from 'react-control-panel';
import { PropTypesOf } from 'ameo-utils';

import { SynthModule, Waveform } from 'src/redux/modules/synthDesigner';
import FilterModule from './Filter';
import { defaultAdsrEnvelope, ControlPanelADSR } from 'src/controls/adsr';
import {
  getReduxInfra,
  get_synth_designer_audio_connectables,
  getVoicePreset,
} from 'src/synthDesigner';
import { updateConnectables } from 'src/patchNetwork';
import { ReduxStore, store, getState } from 'src/redux';
import { voicePresetIdsSelector } from 'src/redux/modules/presets';
import { renderModalWithControls } from 'src/controls/Modal';
import SaveVoicePresetModal from './SaveVoicePresetModal';
import { saveSynthVoicePreset } from 'src/api';

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

const mapStateToProps = (state: ReduxStore) => ({
  voicePresetIds: voicePresetIdsSelector(state),
});

const SynthModuleCompInner: React.FC<{
  index: number;
  synth: SynthModule;
  stateKey: string;
} & ReturnType<typeof mapStateToProps>> = ({
  index,
  synth,
  stateKey,
  children = null,
  voicePresetIds,
}) => {
  const controlPanelContext = useRef<{ preset: number } | null>(null);
  const unison = synth.voices[0].oscillators.length;

  const { dispatch, actionCreators } = getReduxInfra(stateKey);

  return (
    <div className='synth-module'>
      <div
        className='synth-remove-button'
        onClick={() => {
          dispatch(actionCreators.synthDesigner.DELETE_SYNTH_MODULE(index));
          const vcId = stateKey.split('_')[1]!;
          const newConnectables = get_synth_designer_audio_connectables(stateKey);
          updateConnectables(vcId, newConnectables);
        }}
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
        stateKey={stateKey}
      />

      <div className='effects'>{children}</div>

      <div className='presets'>
        <ControlPanel
          proxy
          contextCb={(ctx: { preset: number }) => {
            controlPanelContext.current = ctx;
          }}
          style={{ height: 97 }}
          settings={[
            {
              label: 'preset',
              type: 'select',
              options: { blank: 'blank', ...voicePresetIds },
              initial: 'blank',
            },
            {
              label: 'load preset',
              type: 'button',
              action: () => {
                if (!controlPanelContext.current) {
                  console.error('Control panel context never set!');
                  return;
                }

                const presetId = controlPanelContext.current.preset;
                const allVoicePresets = getState().presets.voicePresets;
                if (typeof allVoicePresets === 'string') {
                  console.error("Somehow voice presets aren't loaded at this point...");
                  return;
                }

                console.log({ allVoicePresets, presetId });
                const preset = allVoicePresets.find(R.propEq('id', +presetId));
                if (R.isNil(preset)) {
                  console.error(
                    `No voice preset found with id ${presetId} even though we have one with that id in the control panel`
                  );
                  return;
                }

                dispatch(actionCreators.synthDesigner.SET_VOICE_STATE(index, preset.body));
              },
            },
            {
              label: 'save preset',
              type: 'button',
              action: async () => {
                const { title, description } = await renderModalWithControls(SaveVoicePresetModal);
                const presetBody = getVoicePreset(stateKey, index);
                await saveSynthVoicePreset({ title, description, body: presetBody });
              },
            },
          ]}
        />
      </div>
    </div>
  );
};

const SynthModuleUnwrapped = connect(mapStateToProps)(SynthModuleCompInner);
const SynthModuleComp: React.FC<Omit<
  PropTypesOf<typeof SynthModuleUnwrapped>,
  keyof ReturnType<typeof mapStateToProps>
>> = ({ ...props }) => (
  <Provider store={store}>
    <SynthModuleUnwrapped {...props} />
  </Provider>
);
export default SynthModuleComp;
