import React, { useState, useCallback, useEffect, Suspense, useRef } from 'react';
import { connect, useDispatch } from 'react-redux';
import ControlPanel, { Button, Custom } from 'react-control-panel';
import ace from 'ace-builds';
import * as R from 'ramda';
// tslint:disable-next-line:no-submodule-imports
import 'ace-builds/webpack-resolver';

import { ReduxStore, dispatch, actionCreators } from '../redux';
import { Effect } from '../redux/modules/effects';
import buildInstance, { analyzerNode } from './buildInstance';
import { EffectPickerCustomInput } from '../controls/faustEditor';
import { BACKEND_BASE_URL, FAUST_COMPILER_ENDPOINT } from '../conf';
import { Without } from '../types';
import {
  SpectrumVisualization,
  initializeSpectrumVisualization,
  defaultSettingsState as defaultVizSettingsState,
  SettingsState as VizSettingsState,
} from '../visualizations/spectrum';
import FileUploader, { Value as FileUploaderValue } from '../controls/FileUploader';

ace.require('ace/theme/twilight');

const ReactAce = React.lazy(() => import('react-ace'));

const audioContext = new AudioContext();

export interface FaustModuleInstance extends ScriptProcessorNode {
  jsonDef: { [key: string]: any };
  // getParamValue: (path: string) => Promise<number>; // <- unimplemented
  setParamValue: (path: string, val: number) => void;
}

const styles: { [key: string]: React.CSSProperties } = {
  root: {
    display: 'flex',
    flexDirection: 'row',
    overflowY: 'scroll',
  },
  codeEditor: {
    display: 'flex',
    flex: 1,
  },
  errorConsole: {
    display: 'flex',
    flex: 1,
    color: '#eee',
    marginLeft: 10,
    fontFamily: "'Oxygen Mono'",
    maxHeight: 600,
    border: '1px solid #555',
    backgroundColor: 'rgba(44,44,44,0.3)',
    maxWidth: '40vw',
  },
  buttonsWrapper: {
    display: 'flex',
    flexDirection: 'row',
    padding: 8,
  },
  editor: {
    border: '1px solid #555',
  },
  spectrumVizCanvas: {
    backgroundColor: '#000',
    imageRendering: 'crisp-edges',
  },
};

type StateProps = Pick<ReduxStore['faustEditor'], 'instance' | 'controlPanel' | 'editorContent'>;

const mapStateToProps = ({ faustEditor }: ReduxStore) => ({
  instance: faustEditor.instance,
  controlPanel: faustEditor.controlPanel,
  editorContent: faustEditor.editorContent,
});

const enhance = connect<StateProps, {}, {}>(mapStateToProps);

// TODO: This shouldn't do connecting and stuff internally; should be refactored to solely construct
// the instance without connecting it to anything.
export const compileFaustInstance = async (
  faustCode: string,
  optimize: boolean,
  mediaFileSourceNode?: AudioScheduledSourceNode | null,
  connectSource = true
) => {
  const formData = new FormData();
  formData.append('code.faust', new Blob([faustCode], { type: 'text/plain' }));
  if (optimize) {
    formData.append('optimize', 'true');
  }
  console.log({ optimize });

  const res = await fetch(FAUST_COMPILER_ENDPOINT, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errMsg = await res.text();
    throw errMsg;
  }

  const wasmInstanceArrayBuffer = await res.arrayBuffer();
  return buildInstance(wasmInstanceArrayBuffer, mediaFileSourceNode, connectSource);
};

const createCompileButtonClickHandler = (
  faustCode: string,
  optimize: boolean,
  setErrMessage: (errMsg: string) => void,
  mediaFileSourceNode?: AudioScheduledSourceNode | null
) => async (useMediaFile: boolean) => {
  let faustInstance;
  try {
    faustInstance = await compileFaustInstance(
      faustCode,
      optimize,
      useMediaFile ? mediaFileSourceNode : undefined
    );
  } catch (err) {
    console.error(err);
    setErrMessage(err.toString());
    return;
  }
  setErrMessage('');

  // Start the audio file playback
  if (useMediaFile && mediaFileSourceNode) {
    mediaFileSourceNode.start(0);
  }
  dispatch(actionCreators.faustEditor.SET_INSTANCE(faustInstance));
};

interface EffectsPickerPanelPassedProps {
  state: object;
  setState: (newState: object) => void;
  loadEffect: (effect: Effect) => void;
}

interface EffectsPickerReduxProps {
  effects: Effect[];
}

type EffectsPickerPannelProps = EffectsPickerPanelPassedProps & EffectsPickerReduxProps;

/**
 * Creates a control panel that contains controls for browsing + loading shared/saved effects
 */
const EffectsPickerPanelInner: React.FunctionComponentFactory<EffectsPickerPanelPassedProps> = ({
  state,
  setState,
  loadEffect,
  effects,
}: EffectsPickerPannelProps) => (
  <ControlPanel
    state={state}
    onChange={(_label: string, _newValue: any, newState: object) => setState(newState)}
    position={{ bottom: 60, right: 8 }}
    draggable
  >
    <Custom label='load effect' renderContainer Comp={EffectPickerCustomInput} />
    <Button
      label='Load'
      action={() => loadEffect(effects.find(R.propEq('id', state['load effect']))!)}
    />
    <Custom label='load file' renderContainer={false} Comp={FileUploader} />
  </ControlPanel>
);

const EffectsPickerPanel = connect(({ effects: { sharedEffects } }: ReduxStore) => ({
  effects: sharedEffects,
}))(EffectsPickerPanelInner);

const SaveControls = ({ editorContent }: { editorContent: string }) => {
  const initialState = { title: '', description: '', saveStatus: '' };
  const [state, setState] = useState(initialState);

  const saveCode = async (effect: Without<Effect, 'id'>) => {
    const res = await fetch(`${BACKEND_BASE_URL}/effects`, {
      method: 'POST',
      body: JSON.stringify(effect),
    });

    if (!res.ok) {
      console.error(`Error saving code: ${await res.text()}`);
      return;
    }

    setState({ ...initialState, saveStatus: 'Successfully saved!' });
  };

  return (
    <div>
      <p>
        Title{' '}
        <input
          type='text'
          value={state.title}
          onChange={evt => setState({ ...state, title: evt.target.value })}
        />
      </p>

      <p>
        Description{' '}
        <textarea
          value={state.description}
          onChange={evt => setState({ ...state, description: evt.target.value })}
        />
      </p>

      <button onClick={() => saveCode({ code: editorContent, ...state })}>Save</button>
      {state.saveStatus}
    </div>
  );
};

interface ControlPanelState {
  'load file'?: FileUploaderValue;
}

const FaustEditor: React.FunctionComponent<{}> = ({
  instance,
  controlPanel: faustInstanceControlPanel,
  editorContent,
}: StateProps & { children: undefined }) => {
  const [
    externalAudioBufferSource,
    setExternalAudioBufferSource,
  ] = useState<AudioBufferSourceNode | null>(null);
  const [optimize, setOptimize] = useState(false);
  const [compileErrMsg, setCompileErrMsg] = useState('');
  const [controlPanelState, setControlPanelState] = useState<ControlPanelState>({});
  const [vizSettingsState, setVizSettingsState] = useState<VizSettingsState | null>(
    defaultVizSettingsState
  );
  const updateVizSettings = useRef<((newSettings: VizSettingsState) => void) | null>(null);

  useEffect(() => {
    if (!updateVizSettings.current || !vizSettingsState) {
      return;
    }

    updateVizSettings.current(vizSettingsState);
  }, [vizSettingsState]);

  useEffect(() => {
    const audioData = controlPanelState['load file'];
    if (!audioData) {
      return;
    }

    audioContext.decodeAudioData(
      audioData.fileContent,
      decodedAudioData => {
        const audioBufferSource = audioContext.createBufferSource();
        audioBufferSource.buffer = decodedAudioData;
        setExternalAudioBufferSource(audioBufferSource);
      },
      err => setCompileErrMsg(`Error decoding provided audio file: ${err}`)
    );
  }, [controlPanelState['load file']]);

  const compile = useCallback(
    createCompileButtonClickHandler(
      editorContent,
      optimize,
      setCompileErrMsg,
      externalAudioBufferSource
    ),
    [editorContent, setCompileErrMsg, externalAudioBufferSource, optimize]
  );

  return (
    <Suspense fallback={<span>Loading...</span>}>
      <div style={styles.root}>
        <ReactAce
          theme='twilight'
          mode='text'
          showPrintMargin={false}
          onChange={newValue => dispatch(actionCreators.faustEditor.SET_EDITOR_CONTENT(newValue))}
          name='ace-editor'
          width='40vw'
          value={editorContent}
          style={styles.editor}
        />

        <div style={styles.errorConsole}>{compileErrMsg}</div>
      </div>

      <div style={styles.buttonsWrapper}>
        <button onClick={() => compile(false)} style={{ marginRight: 10 }}>
          Compile
        </button>
        Optimize
        <input type='checkbox' checked={optimize} onChange={() => setOptimize(!optimize)} />
        {instance ? (
          <button onClick={() => dispatch(actionCreators.faustEditor.CLEAR_ACTIVE_INSTANCE())}>
            Stop
          </button>
        ) : null}
        {externalAudioBufferSource ? (
          <button
            onClick={() => {
              const canvas = document.getElementById('spectrum-visualizer')! as HTMLCanvasElement;
              const settingsUpdater = initializeSpectrumVisualization(analyzerNode, canvas);
              updateVizSettings.current = settingsUpdater;
              settingsUpdater(vizSettingsState);
              externalAudioBufferSource.connect(analyzerNode);
              externalAudioBufferSource.start(0);
            }}
          >
            Start Audio File Playback
          </button>
        ) : null}
        {externalAudioBufferSource ? (
          <button onClick={() => compile(true)} style={{ marginRight: 10 }}>
            Compile + Play Audio File
          </button>
        ) : null}
      </div>

      <SaveControls editorContent={editorContent} />

      {vizSettingsState ? (
        <SpectrumVisualization
          settingsState={vizSettingsState}
          setSettingsState={setVizSettingsState}
        />
      ) : null}

      <canvas
        width={1200}
        height={1024}
        id='spectrum-visualizer'
        style={styles.spectrumVizCanvas}
      />

      {faustInstanceControlPanel}

      <EffectsPickerPanel
        state={controlPanelState}
        setState={setControlPanelState}
        loadEffect={(effect: Effect) =>
          dispatch(actionCreators.faustEditor.SET_EDITOR_CONTENT(effect.code))
        }
      />
    </Suspense>
  );
};

const EnhancedFaustEditor = enhance(FaustEditor);

export default EnhancedFaustEditor;
