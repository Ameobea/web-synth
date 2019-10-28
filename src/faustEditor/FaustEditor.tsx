import React, { useState, useCallback, useEffect, Suspense, useRef } from 'react';
import { connect, Provider } from 'react-redux';
import ControlPanel, { Button, Custom } from 'react-control-panel';
import ace from 'ace-builds';
import * as R from 'ramda';
import { Without, PropTypesOf } from 'ameo-utils';
import 'ace-builds/webpack-resolver';

import { faustReduxInfra } from 'src/faustEditor';
import { Effect } from 'src/redux/modules/effects';
import { EffectPickerCustomInput } from 'src/controls/faustEditor';
import { BACKEND_BASE_URL, FAUST_COMPILER_ENDPOINT } from 'src/conf';
import {
  SpectrumVisualization,
  defaultSettingsState as defaultVizSettingsState,
  SettingsState as VizSettingsState,
  initializeSpectrumVisualization,
} from 'src/visualizations/spectrum';
import { FaustWorkletNode, buildFaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import { faustAudioNodesMap, get_faust_editor_connectables } from 'src/faustEditor';
import { updateConnectables } from 'src/patchNetwork';
import { ReduxStore, store } from 'src/redux';

ace.require('ace/theme/twilight');

type FaustEditorReduxStore = typeof faustReduxInfra.__fullState;

const ReactAce = React.lazy(() => import('react-ace'));

const ctx = new AudioContext();

export const analyzerNode = ctx.createAnalyser();
analyzerNode.smoothingTimeConstant = 0.2;

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

export const compileFaustInstance = async (
  faustCode: string,
  optimize: boolean
): Promise<FaustWorkletNode> => {
  const formData = new FormData();
  formData.append('code.faust', new Blob([faustCode], { type: 'text/plain' }));
  if (optimize) {
    formData.append('optimize', 'true');
  }

  const res = await fetch(FAUST_COMPILER_ENDPOINT, { method: 'POST', body: formData });

  if (!res.ok) {
    const errMsg = await res.text();
    throw errMsg;
  }

  const wasmInstanceArrayBuffer = await res.arrayBuffer();
  return buildFaustWorkletNode(ctx, wasmInstanceArrayBuffer);
};

const createCompileButtonClickHandler = (
  faustCode: string,
  optimize: boolean,
  setErrMessage: (errMsg: string) => void,
  vcId: string
) => async () => {
  let faustInstance;
  try {
    faustInstance = await compileFaustInstance(faustCode, optimize);
  } catch (err) {
    console.error(err);
    setErrMessage(err.toString());
    return;
  }
  setErrMessage('');

  const canvas = document.getElementById('spectrum-visualizer') as HTMLCanvasElement | undefined;
  if (canvas) {
    initializeSpectrumVisualization(analyzerNode, canvas);
    faustInstance.connect(analyzerNode);
  }

  faustAudioNodesMap[vcId] = faustInstance;
  // Since we now have an audio node that we can connect to things, trigger a new audio connectables to be created
  const newConnectables = get_faust_editor_connectables(vcId);
  updateConnectables(vcId, newConnectables);

  faustReduxInfra.dispatch(faustReduxInfra.actionCreators.faustEditor.SET_INSTANCE(faustInstance));
};

const mapEffectsPickerPanelStateToProps = ({ effects: { sharedEffects } }: ReduxStore) => ({
  effects: sharedEffects,
});

/**
 * Creates a control panel that contains controls for browsing + loading shared/saved effects
 */
const EffectsPickerPanelInnerInner: React.FC<
  {
    state: { [key: string]: any };
    setState: (newState: object) => void;
    loadEffect: (effect: Effect) => void;
  } & ReturnType<typeof mapEffectsPickerPanelStateToProps>
> = ({ state, setState, loadEffect, effects }) => (
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
  </ControlPanel>
);

const EffectsPickerPanelInner = connect(mapEffectsPickerPanelStateToProps)(
  EffectsPickerPanelInnerInner
);

const EffectsPickerPanel: React.FC<
  Omit<
    PropTypesOf<typeof EffectsPickerPanelInnerInner>,
    keyof ReturnType<typeof mapEffectsPickerPanelStateToProps>
  >
> = ({ ...props }) => (
  <Provider store={store}>
    <EffectsPickerPanelInner {...props} />
  </Provider>
);

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

const mapStateToProps = ({ faustEditor }: FaustEditorReduxStore) => ({
  instance: faustEditor.instance,
  controlPanel: faustEditor.controlPanel,
  editorContent: faustEditor.editorContent,
});

const FaustEditor: React.FC<{ vcId: string } & ReturnType<typeof mapStateToProps>> = ({
  instance,
  controlPanel: faustInstanceControlPanel,
  editorContent,
  vcId,
}) => {
  const [optimize, setOptimize] = useState(false);
  const [compileErrMsg, setCompileErrMsg] = useState('');
  const [controlPanelState, setControlPanelState] = useState<{ [key: string]: any }>({});
  const [vizSettingsState, setVizSettingsState] = useState<VizSettingsState>(
    defaultVizSettingsState
  );
  const updateVizSettings = useRef<((newSettings: VizSettingsState) => void) | null>(null);

  useEffect(() => {
    if (!updateVizSettings.current || !vizSettingsState) {
      return;
    }

    updateVizSettings.current(vizSettingsState);
  }, [vizSettingsState]);

  const compile = useCallback(
    createCompileButtonClickHandler(editorContent, optimize, setCompileErrMsg, vcId),
    [editorContent, setCompileErrMsg, optimize]
  );

  return (
    <Suspense fallback={<span>Loading...</span>}>
      <div style={styles.root}>
        <ReactAce
          theme='twilight'
          mode='text'
          showPrintMargin={false}
          onChange={newValue =>
            faustReduxInfra.dispatch(
              faustReduxInfra.actionCreators.faustEditor.SET_EDITOR_CONTENT(newValue)
            )
          }
          name='ace-editor'
          width='40vw'
          value={editorContent}
          style={styles.editor}
        />

        <div style={styles.errorConsole}>{compileErrMsg}</div>
      </div>

      <div style={styles.buttonsWrapper}>
        <button onClick={compile} style={{ marginRight: 10 }}>
          Compile
        </button>
        Optimize
        <input type='checkbox' checked={optimize} onChange={() => setOptimize(!optimize)} />
        {instance ? (
          <button
            onClick={() => {
              faustReduxInfra.dispatch(
                faustReduxInfra.actionCreators.faustEditor.CLEAR_ACTIVE_INSTANCE()
              );

              // Create new audio connectables using a passthrough node
              delete faustAudioNodesMap[vcId];
              updateConnectables(vcId, get_faust_editor_connectables(vcId));
            }}
          >
            Stop
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
          faustReduxInfra.dispatch(
            faustReduxInfra.actionCreators.faustEditor.SET_EDITOR_CONTENT(effect.code)
          )
        }
      />
    </Suspense>
  );
};

export default connect(mapStateToProps)(FaustEditor);
