import React, { useEffect, useMemo, useRef } from 'react';
import ControlPanel from 'react-control-panel';
import { Provider, shallowEqual, useDispatch, useSelector } from 'react-redux';

import './SynthDesigner.css';
import { saveSynthPreset } from 'src/api';
import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import { updateConnectables } from 'src/patchNetwork/interface';
import { store, type ReduxStore } from 'src/redux';
import {
  fetchSynthPresets,
  type SynthPresetEntry,
  type SynthVoicePresetEntry,
} from 'src/redux/modules/presets';
import { actionCreators } from 'src/redux';
import { getSynthDesignerReduxInfra, serializeSynthModule } from 'src/redux/modules/synthDesigner';
import {
  get_synth_designer_audio_connectables,
  type SynthDesignerReduxInfra,
  type SynthDesignerReduxStore,
} from 'src/synthDesigner';
import { SpectrumVisualization } from 'src/visualizations/spectrum';
import { buildWavyJonesInstance, type WavyJones } from 'src/visualizations/WavyJones';
import SynthModuleComp from './SynthModule';
import {
  mkGenericPresetPicker,
  type PresetDescriptor,
} from 'src/controls/GenericPresetPicker/GenericPresetPicker';
import { renderModalWithControls } from 'src/controls/Modal';
import { VoicePresetFetchError } from 'src/synthDesigner/VoicePresetFetchError';

interface AddModuleControlsProps {
  stateKey: string;
  synthDesignerActionCreators: SynthDesignerReduxInfra['actionCreators'];
  synthDesignerDispatch: SynthDesignerReduxInfra['dispatch'];
}

const AddModuleControls: React.FC<AddModuleControlsProps> = ({
  stateKey,
  synthDesignerActionCreators,
  synthDesignerDispatch,
}) => {
  const voicePresets = useSelector((state: ReduxStore) => state.presets.voicePresets, shallowEqual);

  const settings = useMemo(() => {
    if (typeof voicePresets === 'string') {
      return [];
    }

    return [
      {
        label: 'add empty',
        type: 'button',
        action: () => {
          const vcId = stateKey.split('_')[1]!;
          synthDesignerDispatch(synthDesignerActionCreators.synthDesigner.ADD_SYNTH_MODULE());
          const newConnectables = get_synth_designer_audio_connectables(stateKey);
          updateConnectables(vcId, newConnectables);
        },
      },
      {
        label: 'add from preset',
        type: 'button',
        disabled: !Array.isArray(voicePresets),
        action: async () => {
          if (!Array.isArray(voicePresets)) {
            return;
          }

          let pickedPreset: PresetDescriptor<SynthVoicePresetEntry>;
          try {
            pickedPreset = await renderModalWithControls(
              mkGenericPresetPicker(() =>
                voicePresets.map(preset => ({ ...preset, preset, name: preset.title }))
              )
            );
          } catch (_err) {
            return; // cancelled
          }

          const vcId = stateKey.split('_')[1]!;
          synthDesignerDispatch(synthDesignerActionCreators.synthDesigner.ADD_SYNTH_MODULE());
          synthDesignerDispatch(
            synthDesignerActionCreators.synthDesigner.SET_VOICE_STATE(-1, pickedPreset.preset.body)
          );
          const newConnectables = get_synth_designer_audio_connectables(stateKey);
          updateConnectables(vcId, newConnectables);
        },
      },
    ];
  }, [stateKey, synthDesignerActionCreators.synthDesigner, synthDesignerDispatch, voicePresets]);

  if (voicePresets === 'FETCH_ERROR') {
    return <VoicePresetFetchError />;
  } else if (typeof voicePresets === 'string') {
    return <div className='presets-loading'>Loading...</div>;
  }

  return <ControlPanel title='module' settings={settings} />;
};

interface FullPresetControlsProps {
  actionCreators: SynthDesignerReduxInfra['actionCreators'];
  stateKey: string;
  getState: SynthDesignerReduxInfra['getState'];
}

const FullPresetControlsInner: React.FC<FullPresetControlsProps> = ({
  actionCreators: { synthDesigner: synthDesignerActionCreators },
  stateKey,
  getState,
}) => {
  const dispatch = useDispatch();
  const synthPresets = useSelector((state: ReduxStore) => state.presets.synthPresets, shallowEqual);

  const settings = useMemo(() => {
    if (typeof synthPresets === 'string') {
      return null;
    }

    return [
      {
        type: 'button',
        label: 'load full preset',
        disabled: !Array.isArray(synthPresets),
        action: async () => {
          if (!Array.isArray(synthPresets)) {
            return;
          }

          let pickedPreset: PresetDescriptor<SynthPresetEntry>;
          try {
            pickedPreset = await renderModalWithControls(
              mkGenericPresetPicker(() =>
                synthPresets.map(preset => ({ ...preset, preset, name: preset.title }))
              )
            );
          } catch (_err) {
            return; // cancelled
          }

          const synths = getState().synthDesigner.synths;
          if (synths.length > 0) {
            const proceed = confirm(
              'Are you sure you want to overwrite the current synth designer?'
            );
            if (!proceed) {
              return;
            }

            for (let i = 0; i < synths.length; i++) {
              dispatch(synthDesignerActionCreators.DELETE_SYNTH_MODULE(synths.length - 1 - i));
            }
          }

          dispatch(synthDesignerActionCreators.SET_SYNTH_PRESET(pickedPreset.preset));
          const newConnectables = get_synth_designer_audio_connectables(stateKey);
          const vcId = stateKey.split('_')[1]!;
          updateConnectables(vcId, newConnectables);
        },
      },
      {
        type: 'button',
        label: 'save full preset',
        action: async () => {
          const { name: title, description } = await renderGenericPresetSaverWithModal({
            description: true,
          });
          const presetBody = getState().synthDesigner.synths.map(serializeSynthModule);
          await saveSynthPreset({
            title,
            description: description ?? '',
            body: { voices: presetBody },
          });
        },
      },
    ];
  }, [synthDesignerActionCreators, dispatch, getState, stateKey, synthPresets]);

  if (synthPresets === 'FETCH_ERROR') {
    return (
      <div className='preset-fetch-error'>
        Error fetching synth presets
        <button
          onClick={() => {
            dispatch(actionCreators.presets.SET_SYNTH_PRESETS('FETCHING'));
            fetchSynthPresets();
          }}
        >
          Retry
        </button>
      </div>
    );
  } else if (typeof synthPresets === 'string') {
    return <div className='presets-loading'>Loading...</div>;
  }

  return <ControlPanel title='synth' settings={settings} />;
};

const FullPresetControls = React.memo(FullPresetControlsInner);

interface AddAndPresetControlsProps extends AddModuleControlsProps {
  synthDesignerGetState: SynthDesignerReduxInfra['getState'];
}

const AddAndPresetControlsInner: React.FC<AddAndPresetControlsProps> = ({ ...props }) => (
  <Provider store={store}>
    <AddModuleControls {...props} />
    <FullPresetControls
      actionCreators={props.synthDesignerActionCreators}
      stateKey={props.stateKey}
      getState={props.synthDesignerGetState}
    />
  </Provider>
);
const AddAndPresetControls = React.memo(AddAndPresetControlsInner);

interface SynthDesignerProps {
  stateKey: string;
}

const SynthDesigner: React.FC<SynthDesignerProps> = ({ stateKey }) => {
  const vcId = stateKey.split('_')[1];
  const oscilloscopeNode = useRef<HTMLDivElement | null>(null);
  const { dispatch, actionCreators, getState } = getSynthDesignerReduxInfra(stateKey);
  const { synths, synthCount, wavyJonesInstanceInitialized, spectrumNode, isHidden } = useSelector(
    (state: SynthDesignerReduxStore) => ({
      synths: state.synthDesigner.synths,
      synthCount: state.synthDesigner.synths.length,
      wavyJonesInstanceInitialized: !!state.synthDesigner.wavyJonesInstance,
      spectrumNode: state.synthDesigner.spectrumNode,
      isHidden: state.synthDesigner.isHidden,
    }),
    shallowEqual
  );

  useEffect(() => {
    if (!oscilloscopeNode.current || synthCount === 0 || wavyJonesInstanceInitialized) {
      return;
    }

    const ctx = new AudioContext();
    const newWavyJonesInstance =
      buildWavyJonesInstance(ctx, 'oscilloscope', 490, 240) ?? (new AnalyserNode(ctx) as WavyJones);
    dispatch(actionCreators.synthDesigner.SET_WAVY_JONES_INSTANCE(newWavyJonesInstance));
  }, [actionCreators.synthDesigner, dispatch, synthCount, wavyJonesInstanceInitialized]);

  return (
    <>
      <div className='synth-designer'>
        {synths.map((synth, i) => (
          <SynthModuleComp
            key={i}
            synth={synth}
            index={i}
            stateKey={stateKey}
            isHidden={isHidden}
            vcId={vcId}
            deleteDisabled={synths.length <= 1}
          />
        ))}

        <AddAndPresetControls
          stateKey={stateKey}
          synthDesignerActionCreators={actionCreators}
          synthDesignerGetState={getState}
          synthDesignerDispatch={dispatch}
        />
      </div>

      <div id='synth-designer-oscilloscope' ref={oscilloscopeNode}></div>

      {spectrumNode ? (
        <SpectrumVisualization paused={isHidden} analyzerNode={spectrumNode} />
      ) : null}
    </>
  );
};

export default SynthDesigner;
