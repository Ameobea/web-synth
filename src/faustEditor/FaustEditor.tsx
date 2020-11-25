import React, { useState, Suspense, useMemo, useRef } from 'react';
import { Provider, useSelector } from 'react-redux';
import ControlPanel, { Button, Custom } from 'react-control-panel';
import * as R from 'ramda';
import { Without, PropTypesOf, ValueOf } from 'ameo-utils';

import { Effect } from 'src/redux/modules/effects';
import { EffectPickerCustomInput } from 'src/controls/faustEditor';
import { BACKEND_BASE_URL, FAUST_COMPILER_ENDPOINT } from 'src/conf';
import { SpectrumVisualization } from 'src/visualizations/spectrum';
import { FaustWorkletNode, buildFaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import { faustEditorContextMap, get_faust_editor_connectables } from 'src/faustEditor';
import { updateConnectables } from 'src/patchNetwork';
import { ReduxStore, store } from 'src/redux';
import { mapUiGroupToControlPanelFields } from 'src/faustEditor/uiBuilder';
// import PolyphonyControls from './PolyphonyControls';
// import { FaustEditorPolyphonyState } from 'src/redux/modules/faustEditor';

type FaustEditorReduxStore = ReturnType<typeof faustEditorContextMap.key.reduxInfra.getState>;

const CodeEditor = React.lazy(() => import('./CodeEditor'));

const ctx = new AudioContext();

const styles: { [key: string]: React.CSSProperties } = {
  root: {
    display: 'flex',
    flexDirection: 'row',
    overflowY: 'auto',
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
    maxWidth: 'calc(50vw - 40px)',
  },
  buttonsWrapper: {
    display: 'flex',
    flexDirection: 'row',
    padding: 8,
  },
  bottomContent: {
    display: 'flex',
    flexDirection: 'column',
    padding: 8,
  },
};

const moduleIdHeaderName = 'X-Faust-Module-ID';

export const compileFaustInstance = async (
  faustCode: string,
  optimize: boolean,
  context: ValueOf<typeof faustEditorContextMap>
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
  return buildFaustWorkletNode(ctx, wasmInstanceArrayBuffer, moduleID, context);
};

/**
 * Creates a control panel that contains controls for browsing + loading shared/saved effects
 */
const EffectsPickerPanelInner: React.FC<{
  state: { [key: string]: any };
  setState: (newState: any) => void;
  loadEffect: (effect: Effect) => void;
}> = ({ state, setState, loadEffect }) => {
  const effects = useSelector(({ effects: { sharedEffects } }: ReduxStore) => sharedEffects);

  return (
    <ControlPanel
      state={state}
      onChange={(_label: string, _newValue: any, newState: any) => setState(newState)}
      position={{ bottom: 60, right: 44 }}
      draggable
    >
      <Custom label='load program' renderContainer Comp={EffectPickerCustomInput} />
      <Button
        label='Load'
        action={() => loadEffect(effects.find(R.propEq('id', state['load program']))!)}
      />
    </ControlPanel>
  );
};

const EffectsPickerPanel: React.FC<PropTypesOf<typeof EffectsPickerPanelInner>> = ({
  ...props
}) => (
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
      <h2>Save Program</h2>

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

export const mkCompileButtonClickHandler = ({
  faustCode,
  optimize,
  setErrMessage,
  vcId,
  analyzerNode,
}: {
  faustCode: string;
  optimize: boolean;
  setErrMessage: (errMsg: string) => void;
  vcId: string;
  analyzerNode: AnalyserNode;
}) => async () => {
  const context = faustEditorContextMap[vcId];
  let faustNode: FaustWorkletNode;
  try {
    faustNode = await compileFaustInstance(faustCode, optimize, context);
  } catch (err) {
    console.error(err);
    setErrMessage(err.toString());
    return;
  }
  setErrMessage('');

  const uiItems = faustNode.jsonDef.ui as any[];
  const settings = R.flatten(
    uiItems.map(item =>
      mapUiGroupToControlPanelFields(item, () => void 0, context.paramDefaultValues)
    )
  ) as any[];

  faustNode.connect(analyzerNode);

  if (!context) {
    throw new Error(`No context found for Faust editor vcId ${vcId}`);
  }
  faustEditorContextMap[vcId] = { ...context, analyzerNode, faustNode };
  context.reduxInfra.dispatch(
    context.reduxInfra.actionCreators.faustEditor.SET_CACHED_INPUT_NAMES(
      settings.map(R.prop('label')) as string[]
    )
  );

  // Since we now have an audio node that we can connect to things, trigger a new audio connectables to be created
  const newConnectables = get_faust_editor_connectables(vcId);
  updateConnectables(vcId, newConnectables);

  context.reduxInfra.dispatch(
    context.reduxInfra.actionCreators.faustEditor.SET_INSTANCE(faustNode, vcId)
  );
};

/**
 * Returns a function that stops the currently running Faust editor instance, setting Redux and `faustEditorContextMap`
 * to reflect this new state;
 */
export const mkStopInstanceHandler = ({
  vcId,
  context,
}: {
  vcId: string;
  context: ValueOf<typeof faustEditorContextMap>;
}) => () => {
  context.reduxInfra.dispatch(
    context.reduxInfra.actionCreators.faustEditor.CLEAR_ACTIVE_INSTANCE()
  );

  // Disconnect the internal connection between the nodes so that the nodes can be garbage collected
  if (!context.faustNode) {
    throw new Error(
      `\`faustNode\` should have been set by now since the Faust editor is now being stopped for vcId ${vcId} but they haven't`
    );
  }
  context.faustNode.disconnect(context.analyzerNode);
  context.faustNode.shutdown();
  delete context.faustNode;

  context.paramDefaultValues = Object.fromEntries(
    Object.entries(context.overrideableParams).map(([address, param]) => [
      address,
      param.manualControl.offset.value,
    ])
  );

  // Create new audio connectables using a passthrough node
  updateConnectables(vcId, get_faust_editor_connectables(vcId));
  context.overrideableParams = {};
};

const FaustEditor: React.FC<{
  vcId: string;
}> = ({ vcId }) => {
  const {
    instance,
    ControlPanelComponent: FaustInstanceControlPanelComponent,
    editorContent,
    isHidden,
    // polyphonyState,
  } = useSelector(({ faustEditor }: FaustEditorReduxStore) =>
    R.pick(
      ['instance', 'ControlPanelComponent', 'editorContent', 'isHidden', 'polyphonyState'],
      faustEditor
    )
  );
  const [optimize, setOptimize] = useState(true);
  const [compileErrMsg, setCompileErrMsg] = useState('');
  const [controlPanelState, setControlPanelState] = useState<{ [key: string]: any }>({});
  const context = faustEditorContextMap[vcId];

  const compile = mkCompileButtonClickHandler({
    faustCode: editorContent,
    optimize,
    setErrMessage: setCompileErrMsg,
    vcId,
    analyzerNode: context.analyzerNode,
  });
  const didCompileOnMount = useRef(false);
  if (context.compileOnMount && !didCompileOnMount.current) {
    didCompileOnMount.current = true;
    compile();
  }

  const stopInstance = useMemo(() => mkStopInstanceHandler({ vcId, context }), [context, vcId]);

  return (
    <Suspense fallback={<span>Loading...</span>}>
      <div style={styles.root}>
        <CodeEditor
          onChange={newValue =>
            context.reduxInfra.dispatch(
              context.reduxInfra.actionCreators.faustEditor.SET_EDITOR_CONTENT(newValue)
            )
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
      <div style={styles.bottomContent}>
        {/* <PolyphonyControls
          state={polyphonyState}
          setState={(newState: FaustEditorPolyphonyState) =>
            reduxInfra.dispatch(reduxInfra.actionCreators.faustEditor.SET_POLYPHONY_STATE(newState))
          }
        /> */}

        <SaveControls editorContent={editorContent} />

        {FaustInstanceControlPanelComponent ? <FaustInstanceControlPanelComponent /> : null}

        <EffectsPickerPanel
          state={controlPanelState}
          setState={setControlPanelState}
          loadEffect={(effect: Effect) =>
            context.reduxInfra.dispatch(
              context.reduxInfra.actionCreators.faustEditor.SET_EDITOR_CONTENT(effect.code)
            )
          }
        />
      </div>

      <SpectrumVisualization paused={isHidden} analyzerNode={context.analyzerNode} />
    </Suspense>
  );
};

export default FaustEditor;
