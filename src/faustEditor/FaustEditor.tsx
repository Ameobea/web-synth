import React, { useState, useCallback, Suspense, useMemo } from 'react';
import { connect, Provider } from 'react-redux';
import ControlPanel, { Button, Custom } from 'react-control-panel';
import * as R from 'ramda';
import { Without, PropTypesOf, ValueOf } from 'ameo-utils';

import { Effect } from 'src/redux/modules/effects';
import { EffectPickerCustomInput } from 'src/controls/faustEditor';
import { BACKEND_BASE_URL, FAUST_COMPILER_ENDPOINT } from 'src/conf';
import { SpectrumVisualization } from 'src/visualizations/spectrum';
import { FaustWorkletNode, buildFaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import {
  faustEditorContextMap,
  get_faust_editor_connectables,
  FaustEditorReduxInfra,
} from 'src/faustEditor';
import { updateConnectables } from 'src/patchNetwork';
import { ReduxStore, store } from 'src/redux';

type FaustEditorReduxStore = typeof faustEditorContextMap.key.reduxInfra.__fullState;

const CodeEditor = React.lazy(() => import('./CodeEditor'));

const ctx = new AudioContext();

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
};

const moduleIdHeaderName = 'X-Faust-Module-ID';

export const compileFaustInstance = async (
  faustCode: string,
  optimize: boolean
): Promise<FaustWorkletNode> => {
  const formData = new FormData();
  formData.append('code.faust', new Blob([faustCode], { type: 'text/plain' }));
  if (optimize) {
    formData.append('optimize', 'true');
  }

  const res = await fetch(`${FAUST_COMPILER_ENDPOINT}/compile`, { method: 'POST', body: formData });
  const moduleID = res.headers.get(moduleIdHeaderName);
  if (!moduleID) {
    throw new Error(`No \`${moduleIdHeaderName}\` header set in response from Faust compiler`);
  }

  if (!res.ok) {
    const errMsg = await res.text();
    throw errMsg;
  }

  const wasmInstanceArrayBuffer = await res.arrayBuffer();
  return buildFaustWorkletNode(ctx, wasmInstanceArrayBuffer, moduleID);
};

const mapEffectsPickerPanelStateToProps = ({ effects: { sharedEffects } }: ReduxStore) => ({
  effects: sharedEffects,
});

/**
 * Creates a control panel that contains controls for browsing + loading shared/saved effects
 */
const EffectsPickerPanelInnerInner: React.FC<{
  state: { [key: string]: any };
  setState: (newState: object) => void;
  loadEffect: (effect: Effect) => void;
} & ReturnType<typeof mapEffectsPickerPanelStateToProps>> = ({
  state,
  setState,
  loadEffect,
  effects,
}) => (
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

const EffectsPickerPanel: React.FC<Omit<
  PropTypesOf<typeof EffectsPickerPanelInnerInner>,
  keyof ReturnType<typeof mapEffectsPickerPanelStateToProps>
>> = ({ ...props }) => (
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

export const mkCompileButtonClickHandler = ({
  faustCode,
  optimize,
  setErrMessage,
  vcId,
  analyzerNode,
  noBuildControlPanel,
}: {
  faustCode: string;
  optimize: boolean;
  setErrMessage: (errMsg: string) => void;
  vcId: string;
  analyzerNode: AnalyserNode;
  noBuildControlPanel?: boolean;
}) => async () => {
  let faustNode;
  try {
    faustNode = await compileFaustInstance(faustCode, optimize);
  } catch (err) {
    console.error(err);
    setErrMessage(err.toString());
    return;
  }
  setErrMessage('');

  faustNode.connect(analyzerNode);

  const context = faustEditorContextMap[vcId];
  if (!context) {
    throw new Error(`No context found for Faust editor vcId ${vcId}`);
  }
  faustEditorContextMap[vcId] = { ...context, analyzerNode, faustNode };

  // Since we now have an audio node that we can connect to things, trigger a new audio connectables to be created
  const newConnectables = get_faust_editor_connectables(vcId);
  updateConnectables(vcId, newConnectables);

  context.reduxInfra.dispatch(
    context.reduxInfra.actionCreators.faustEditor.SET_INSTANCE(faustNode, noBuildControlPanel)
  );
};

/**
 * Returns a function that stops the currently running Faust editor instance, setting Redux and `faustEditorContextMap`
 * to reflect this new state;
 */
export const mkStopInstanceHandler = ({
  reduxInfra,
  vcId,
  context,
}: {
  reduxInfra: FaustEditorReduxInfra;
  vcId: string;
  context: Pick<ValueOf<typeof faustEditorContextMap>, 'faustNode' | 'analyzerNode'>;
}) => () => {
  reduxInfra.dispatch(reduxInfra.actionCreators.faustEditor.CLEAR_ACTIVE_INSTANCE());

  // Disconnect the internal connection between the nodes so that the nodes can be garbage collected
  const { faustNode, analyzerNode } = context;
  if (!faustNode) {
    throw new Error(
      `\`faustNode\` should have been set by now since the Faust editor is now being stopped for vcId ${vcId} but they haven't`
    );
  }
  faustNode.disconnect(analyzerNode);

  // Create new audio connectables using a passthrough node
  delete faustEditorContextMap[vcId]!.faustNode;
  updateConnectables(vcId, get_faust_editor_connectables(vcId));
};

const FaustEditor: React.FC<{ vcId: string } & ReturnType<typeof mapStateToProps>> = ({
  instance,
  controlPanel: faustInstanceControlPanel,
  editorContent,
  vcId,
}) => {
  const [optimize, setOptimize] = useState(false);
  const [compileErrMsg, setCompileErrMsg] = useState('');
  const [controlPanelState, setControlPanelState] = useState<{ [key: string]: any }>({});

  const { reduxInfra, ...context } = useMemo(() => {
    const context = faustEditorContextMap[vcId];
    if (!context) {
      throw new Error(
        `Context should have been set already for Faust editor vcId ${vcId} but it has not`
      );
    }
    return context;
    // \/ We need this because of the dirty mutable state thing we have going with `faustEditorContextMap`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vcId, instance]);

  const compile = useCallback(
    mkCompileButtonClickHandler({
      faustCode: editorContent,
      optimize,
      setErrMessage: setCompileErrMsg,
      vcId,
      analyzerNode: context.analyzerNode,
    }),
    [editorContent, setCompileErrMsg, optimize, context.analyzerNode]
  );

  const stopInstance = useMemo(() => mkStopInstanceHandler({ reduxInfra, vcId, context }), [
    context,
    reduxInfra,
    vcId,
  ]);

  return (
    <Suspense fallback={<span>Loading...</span>}>
      <div style={styles.root}>
        <CodeEditor
          onChange={newValue =>
            reduxInfra.dispatch(reduxInfra.actionCreators.faustEditor.SET_EDITOR_CONTENT(newValue))
          }
          value={editorContent}
        />

        <div style={styles.errorConsole}>{compileErrMsg}</div>
      </div>

      <div style={styles.buttonsWrapper}>
        <button onClick={compile} style={{ marginRight: 10 }}>
          Compile
        </button>
        Optimize
        <input type='checkbox' checked={optimize} onChange={() => setOptimize(!optimize)} />
        {instance ? <button onClick={stopInstance}>Stop</button> : null}
      </div>

      <SaveControls editorContent={editorContent} />

      <SpectrumVisualization analyzerNode={context.analyzerNode} />

      {faustInstanceControlPanel}

      <EffectsPickerPanel
        state={controlPanelState}
        setState={setControlPanelState}
        loadEffect={(effect: Effect) =>
          reduxInfra.dispatch(reduxInfra.actionCreators.faustEditor.SET_EDITOR_CONTENT(effect.code))
        }
      />
    </Suspense>
  );
};

export default connect(mapStateToProps)(FaustEditor);
