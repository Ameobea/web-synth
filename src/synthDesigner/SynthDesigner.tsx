import React, { useEffect, useMemo, useRef, useState } from 'react';
import { connect, Provider, useSelector } from 'react-redux';
import * as R from 'ramda';
import ControlPanel from 'react-control-panel';
import { PropTypesOf, UnreachableException } from 'ameo-utils';

import { serializeSynthModule } from 'src/redux/modules/synthDesigner';
import { SpectrumVisualization } from 'src/visualizations/spectrum';
import {
  SynthDesignerReduxStore,
  getReduxInfra,
  get_synth_designer_audio_connectables,
  SynthDesignerReduxInfra,
} from 'src/synthDesigner';
import { ReduxStore, store } from 'src/redux';
import { voicePresetIdsSelector } from 'src/redux/modules/presets';
import SynthModuleComp from './SynthModule';
import './SynthDesigner.scss';
import { renderModalWithControls } from 'src/controls/Modal';
import SavePresetModal from 'src/synthDesigner/SavePresetModal';
import { saveSynthPreset } from 'src/api';
import { updateConnectables } from 'src/patchNetwork/interface';
import { buildWavyJonesInstance, WavyJones } from 'src/visualizations/WavyJones';
import { useWhyDidYouUpdate } from 'src/reactUtils';

const mapAddModuleControlsStateToProps = (state: ReduxStore) => ({
  voicePresets: state.presets.voicePresets,
  voicePresetIds: voicePresetIdsSelector(state),
});

const AddModuleControlsInner: React.FC<
  {
    stateKey: string;
    synthDesignerActionCreators: SynthDesignerReduxInfra['actionCreators'];
    synthDesignerDispatch: SynthDesignerReduxInfra['dispatch'];
    synthDesignerGetState: SynthDesignerReduxInfra['getState'];
  } & ReturnType<typeof mapAddModuleControlsStateToProps>
> = ({
  stateKey,
  voicePresets,
  voicePresetIds,
  synthDesignerActionCreators,
  synthDesignerDispatch,
}) => {
  useWhyDidYouUpdate('sd', {
    stateKey,
    asdfasdf: synthDesignerActionCreators.synthDesigner,
    synthDesignerDispatch,
    voicePresetIds,
    voicePresets,
  });
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
            synthDesignerActionCreators.synthDesigner.SET_VOICE_STATE(
              -1,
              selectedVoicePreset,
              synthDesignerDispatch
            )
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

const FullPresetControls: React.FC<{
  actionCreators: SynthDesignerReduxInfra['actionCreators'];
  stateKey: string;
  getState: SynthDesignerReduxInfra['getState'];
  dispatch: SynthDesignerReduxInfra['dispatch'];
}> = ({ actionCreators, stateKey, getState, dispatch }) => {
  const { synthPresets } = useSelector((state: ReduxStore) => ({
    synthPresets: state.presets.synthPresets,
  }));
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
              synthPresets.find(preset => preset.id === state.preset)!,
              dispatch
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
          const { title, description } = await renderModalWithControls(SavePresetModal);
          const presetBody = getState().synthDesigner.synths.map(serializeSynthModule);
          await saveSynthPreset({ title, description, body: { voices: presetBody } });
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

const AddModuleControlsUnwrapped = connect(mapAddModuleControlsStateToProps)(
  AddModuleControlsInner
);
const AddAndPresetControls: React.FC<
  Omit<
    PropTypesOf<typeof AddModuleControlsInner> & {
      synthDesignerGetState: SynthDesignerReduxInfra['getState'];
    },
    keyof ReturnType<typeof mapAddModuleControlsStateToProps>
  >
> = ({ ...props }) => (
  <Provider store={store}>
    <AddModuleControlsUnwrapped {...props} />
    <FullPresetControls
      actionCreators={props.synthDesignerActionCreators}
      stateKey={props.stateKey}
      getState={props.synthDesignerGetState}
      dispatch={props.synthDesignerDispatch}
    />
  </Provider>
);

const mapStateToProps = ({ synthDesigner }: SynthDesignerReduxStore) => ({
  synthDesignerState: synthDesigner,
});

const SynthDesigner: React.FC<{ stateKey: string } & ReturnType<typeof mapStateToProps>> = ({
  synthDesignerState,
  stateKey,
}) => {
  const oscilloscopeNode = useRef<HTMLDivElement | null>(null);
  const { dispatch, actionCreators, getState } = getReduxInfra(stateKey);

  useEffect(() => {
    if (
      !oscilloscopeNode.current ||
      R.isEmpty(synthDesignerState.synths) ||
      synthDesignerState.wavyJonesInstance
    ) {
      return;
    }

    const newWavyJonesInstance = buildWavyJonesInstance(
      new AudioContext(),
      'oscilloscope',
      490,
      240
    );
    dispatch(actionCreators.synthDesigner.SET_WAVY_JONES_INSTANCE(newWavyJonesInstance));
  }, [
    actionCreators.synthDesigner,
    dispatch,
    synthDesignerState.synths,
    synthDesignerState.wavyJonesInstance,
  ]);

  return (
    <>
      <div className='synth-designer'>
        {synthDesignerState.synths.map((synth, i) => (
          <SynthModuleComp key={i} synth={synth} index={i} stateKey={stateKey}>
            {/* effects */}
          </SynthModuleComp>
        ))}

        <AddAndPresetControls
          stateKey={stateKey}
          synthDesignerActionCreators={actionCreators}
          synthDesignerDispatch={dispatch}
          synthDesignerGetState={getState}
        />
      </div>

      <button
        onMouseDown={() => dispatch(actionCreators.synthDesigner.GATE(440, 0))}
        onMouseUp={() =>
          dispatch(actionCreators.synthDesigner.UNGATE(() => getState().synthDesigner, 0))
        }
      >
        Gate
      </button>

      <div id='synth-designer-oscilloscope' ref={oscilloscopeNode}></div>

      {synthDesignerState.spectrumNode ? (
        <SpectrumVisualization
          paused={synthDesignerState.isHidden}
          analyzerNode={synthDesignerState.spectrumNode}
        />
      ) : null}
    </>
  );
};

export default connect(mapStateToProps)(SynthDesigner);
