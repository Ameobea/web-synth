import { UnreachableException } from 'ameo-utils';
import * as R from 'ramda';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { Provider, shallowEqual, useSelector } from 'react-redux';

import './SynthDesigner.scss';

import { saveSynthPreset } from 'src/api';
import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import { updateConnectables } from 'src/patchNetwork/interface';
import { type ReduxStore, store } from 'src/redux';
import { voicePresetIdsSelector } from 'src/redux/modules/presets';
import { getSynthDesignerReduxInfra, serializeSynthModule } from 'src/redux/modules/synthDesigner';
import {
  get_synth_designer_audio_connectables,
  type SynthDesignerReduxInfra,
  type SynthDesignerReduxStore,
} from 'src/synthDesigner';
import { SpectrumVisualization } from 'src/visualizations/spectrum';
import { buildWavyJonesInstance, type WavyJones } from 'src/visualizations/WavyJones';
import SynthModuleComp from './SynthModule';

interface AddModuleControlsProps {
  stateKey: string;
  synthDesignerActionCreators: SynthDesignerReduxInfra['actionCreators'];
  synthDesignerDispatch: SynthDesignerReduxInfra['dispatch'];
  synthDesignerGetState: SynthDesignerReduxInfra['getState'];
}

const AddModuleControls: React.FC<AddModuleControlsProps> = ({
  stateKey,
  synthDesignerActionCreators,
  synthDesignerDispatch,
}) => {
  const { voicePresets, voicePresetIds } = useSelector(
    (state: ReduxStore) => ({
      voicePresets: state.presets.voicePresets,
      voicePresetIds: voicePresetIdsSelector(state),
    }),
    shallowEqual
  );
  const controlPanelContext = useRef<{ [label: string]: any } | undefined>();
  const settings = useMemo(() => {
    if (typeof voicePresets === 'string') {
      return [];
    }

    return [
      {
        label: 'preset',
        type: 'select',
        options: { blank: 'blank', ...voicePresetIds },
        initial: 'blank',
      },
      {
        label: 'add synth module',
        type: 'button',
        action: () => {
          if (!controlPanelContext.current) {
            throw new Error('Control panel context not set!');
          }

          const selectedVoicePresetId: number = controlPanelContext.current['preset'];
          const selectedVoicePreset = voicePresets?.[selectedVoicePresetId]?.body;

          const vcId = stateKey.split('_')[1]!;
          synthDesignerDispatch(synthDesignerActionCreators.synthDesigner.ADD_SYNTH_MODULE());
          synthDesignerDispatch(
            synthDesignerActionCreators.synthDesigner.SET_VOICE_STATE(-1, selectedVoicePreset)
          );
          const newConnectables = get_synth_designer_audio_connectables(stateKey);
          updateConnectables(vcId, newConnectables);
        },
      },
    ];
  }, [
    stateKey,
    synthDesignerActionCreators.synthDesigner,
    synthDesignerDispatch,
    voicePresetIds,
    voicePresets,
  ]);

  if (typeof voicePresets === 'string') {
    return <>Loading...</>;
  }

  return (
    <ControlPanel
      title='voice preset'
      contextCb={(ctx: { [label: string]: any }) => {
        controlPanelContext.current = ctx;
      }}
      settings={settings}
    />
  );
};

interface FullPresetControlsProps {
  actionCreators: SynthDesignerReduxInfra['actionCreators'];
  stateKey: string;
  getState: SynthDesignerReduxInfra['getState'];
  dispatch: SynthDesignerReduxInfra['dispatch'];
}

const FullPresetControlsInner: React.FC<FullPresetControlsProps> = ({
  actionCreators,
  stateKey,
  getState,
  dispatch,
}) => {
  const synthPresets = useSelector((state: ReduxStore) => state.presets.synthPresets, shallowEqual);
  const [state, setState] = useState<{ preset: number | undefined | null }>({ preset: undefined });
  useEffect(() => {
    if (typeof synthPresets !== 'string' && !state.preset && synthPresets.length > 0) {
      setState({ preset: synthPresets[0]?.id });
    }
  }, [synthPresets, state]);

  const settings = useMemo(() => {
    if (typeof synthPresets === 'string') {
      return null;
    }

    return [
      {
        label: 'preset',
        type: 'select',
        options: Object.fromEntries(synthPresets.map(preset => [preset.title, preset.id])),
        initial: synthPresets[0]?.id,
      },
      {
        type: 'button',
        label: 'load full preset',
        action: () => {
          if (R.isNil(state.preset)) {
            return;
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
              dispatch(actionCreators.synthDesigner.DELETE_SYNTH_MODULE(synths.length - 1 - i));
            }
          }

          dispatch(
            actionCreators.synthDesigner.SET_SYNTH_PRESET(
              synthPresets.find(preset => preset.id === state.preset)!
            )
          );
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
  }, [synthPresets, state.preset, dispatch, actionCreators.synthDesigner, stateKey, getState]);

  if (typeof synthPresets === 'string') {
    return <>Loading...</>;
  }

  return (
    <ControlPanel
      title='synth preset'
      state={state}
      settings={settings}
      onChange={(key: string, val: any, _state: any) => {
        if (key === 'preset') {
          setState({ preset: val });
          return;
        }

        throw new UnreachableException();
      }}
    />
  );
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
      dispatch={props.synthDesignerDispatch}
    />
  </Provider>
);
const AddAndPresetControls = React.memo(AddAndPresetControlsInner);

const SynthDesigner: React.FC<{ stateKey: string }> = ({ stateKey }) => {
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
    })
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
          />
        ))}

        <AddAndPresetControls
          stateKey={stateKey}
          synthDesignerActionCreators={actionCreators}
          synthDesignerDispatch={dispatch}
          synthDesignerGetState={getState}
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
