import * as R from 'ramda';
import React, { useMemo, useRef, useState } from 'react';
import { connect, Provider } from 'react-redux';
import ControlPanel from 'react-control-panel';
import { PropTypesOf, UnreachableException } from 'ameo-utils';
import { Option } from 'funfix-core';

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
import SavePresetModal from './SavePresetModal';
import { saveSynthVoicePreset } from 'src/api';

const SYNTH_SETTINGS = [
  {
    type: 'range',
    label: 'volume',
    min: -1,
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
    type: 'text',
    label: 'pitch multiplier',
    initial: '1',
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

const SynthModuleCompInner: React.FC<
  {
    index: number;
    synth: SynthModule;
    stateKey: string;
  } & ReturnType<typeof mapStateToProps>
> = ({ index, synth, stateKey, children = null, voicePresetIds }) => {
  const controlPanelContext = useRef<{ preset: string } | null>(null);
  const unison = synth.voices[0].oscillators.length;
  const [localPitchMultiplier, setLocalPitchMultiplier] = useState<string | null>(null);

  const { dispatch, actionCreators } = getReduxInfra(stateKey);
  const wavetableUIState = useMemo(() => {
    if (!synth.wavetableConf) {
      return null;
    }

    const acc = synth.wavetableConf.intraDimMixes.reduce((acc, mix, dimIx) => {
      acc[`intra_dim_${dimIx}_mix`] = mix;
      return acc;
    }, {} as { [key: string]: number });
    return synth.wavetableConf.interDimMixes.reduce((acc, mix, dimIx) => {
      acc[`inter_dim_${dimIx}_mix`] = mix;
      return acc;
    }, acc);
  }, [synth.wavetableConf]);

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
              dispatch(
                actionCreators.synthDesigner.SET_WAVEFORM(
                  index,
                  val,
                  dispatch,
                  stateKey.split('_')[1]
                )
              );
              return;
            }
            case 'unison': {
              dispatch(actionCreators.synthDesigner.SET_UNISON(index, val));
              return;
            }
            case 'volume': {
              dispatch(actionCreators.synthDesigner.SET_SYNTH_MASTER_GAIN(index, val));
              return;
            }
            case 'detune': {
              dispatch(actionCreators.synthDesigner.SET_DETUNE(val, index));
              return;
            }
            case 'adsr': {
              dispatch(actionCreators.synthDesigner.SET_GAIN_ADSR(val, index));
              return;
            }
            case 'pitch multiplier': {
              setLocalPitchMultiplier(val);
              const value = Number.parseFloat(val);
              if (Number.isNaN(value)) {
                return;
              }
              dispatch(actionCreators.synthDesigner.SET_PITCH_MULTIPLIER(index, value));
              return;
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
            'pitch multiplier': Option.of(localPitchMultiplier).getOrElseL(() =>
              synth.pitchMultiplier.toString()
            ),
          }),
          [
            synth.waveform,
            unison,
            synth.masterGain,
            synth.detune,
            synth.gainEnvelope,
            synth.pitchMultiplier,
            localPitchMultiplier,
          ]
        )}
        style={{ width: 378 }}
      />

      {synth.waveform === 'wavetable' ? (
        <ControlPanel
          title='WAVETABLE'
          settings={[
            ...synth.wavetableConf!.intraDimMixes.map((_mix, dimIx) => ({
              type: 'range',
              min: 0,
              max: 1,
              label: `intra_dim_${dimIx}_mix`,
            })),
            ...synth.wavetableConf!.interDimMixes.map((_mix, dimIx) => ({
              type: 'range',
              min: 0,
              max: 1,
              label: `inter_dim_${dimIx}_mix`,
            })),
          ]}
          onChange={(key: string, val: any) => {
            if (key.startsWith('intra_dim_')) {
              const dimIx = +key.split('intra_dim_')[1].split('_mix')[0];
              dispatch({ type: 'SET_WAVETABLE_INTRA_DIM_MIX', synthIx: index, dimIx, mix: val });
              return;
            } else if (key.startsWith('inter_dim_')) {
              const baseDimIx = +key.split('inter_dim_')[1].split('_mix')[0];
              dispatch({
                type: 'SET_WAVETABLE_INTER_DIM_MIX',
                synthIx: index,
                baseDimIx,
                mix: val,
              });
              return;
            }

            throw new UnreachableException(`Unhandled wavetable key: ${key}`);
          }}
          state={wavetableUIState}
        />
      ) : null}

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
          contextCb={(ctx: { preset: string }) => {
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

                const preset =
                  presetId === 'blank' ? null : allVoicePresets.find(R.propEq('id', +presetId));
                if (preset === undefined) {
                  console.error(
                    `No voice preset found with id ${presetId} even though we have one with that id in the control panel`
                  );
                  return;
                }

                dispatch(
                  actionCreators.synthDesigner.SET_VOICE_STATE(
                    index,
                    preset ? preset.body : null,
                    dispatch
                  )
                );
              },
            },
            {
              label: 'save preset',
              type: 'button',
              action: async () => {
                const { title, description } = await renderModalWithControls(SavePresetModal);
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
