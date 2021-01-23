import React, { useState, Suspense, useMemo, useRef, useEffect } from 'react';
import { Provider, useSelector } from 'react-redux';
import ControlPanel, { Button, Custom } from 'react-control-panel';
import * as R from 'ramda';
import { Without, PropTypesOf, ValueOf, filterNils } from 'ameo-utils';

import { Effect } from 'src/redux/modules/effects';
import { EffectPickerCustomInput } from 'src/controls/faustEditor';
import { FAUST_COMPILER_ENDPOINT } from 'src/conf';
import { SpectrumVisualization } from 'src/visualizations/spectrum';
import { FaustWorkletNode, buildFaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import { faustEditorContextMap, get_faust_editor_connectables } from 'src/faustEditor';
import { updateConnectables } from 'src/patchNetwork/interface';
import { ReduxStore, store } from 'src/redux';
import { saveEffect } from 'src/api';
import { DynamicCodeWorkletNode } from 'src/faustEditor/DymanicCodeWorkletNode';
import { buildSoulWorkletNode } from 'src/faustEditor/SoulAudioWorklet';
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
    fontFamily: "'Oxygen Mono', monospace",
    maxHeight: 600,
    border: '1px solid #555',
    backgroundColor: 'rgba(44,44,44,0.3)',
    maxWidth: 'calc(50vw - 40px)',
  },
  bottomContent: {
    display: 'flex',
    flexDirection: 'column',
    padding: 8,
  },
};

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
  const moduleIdHeaderName = 'X-Faust-Module-ID';
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

export const compileSoulInstance = async (
  code: string,
  _optimize: boolean,
  context: ValueOf<typeof faustEditorContextMap>
): Promise<DynamicCodeWorkletNode> => {
  const res = await fetch(`${FAUST_COMPILER_ENDPOINT}/soul/compile`, {
    method: 'POST',
    body: code,
  });
  const moduleIdHeaderName = 'X-Soul-Module-ID';
  const moduleID = res.headers.get(moduleIdHeaderName);
  if (!moduleID) {
    throw new Error(`No \`${moduleIdHeaderName}\` header set in response from Faust compiler`);
  }

  if (!res.ok) {
    const errMsg = await res.text();
    throw errMsg;
  }

  const wasmInstanceArrayBuffer = await res.arrayBuffer();
  return buildSoulWorkletNode(ctx, wasmInstanceArrayBuffer, moduleID, context);
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
    try {
      await saveEffect(effect);
      setState({ ...initialState, saveStatus: 'Successfully saved!' });
    } catch (err) {
      console.error('Error saving effect: ', err);
    }
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

type CodeCompiler = (
  code: string,
  optimize: boolean,
  context: ValueOf<typeof faustEditorContextMap>
) => Promise<DynamicCodeWorkletNode>;

export const mkCompileButtonClickHandler = ({
  code,
  optimize,
  setErrMessage,
  vcId,
  analyzerNode,
  compiler = compileFaustInstance,
}: {
  code: string;
  optimize: boolean;
  setErrMessage: (errMsg: string) => void;
  vcId: string;
  analyzerNode: AnalyserNode;
  compiler?: CodeCompiler;
}) => async () => {
  const context = faustEditorContextMap[vcId];
  let codeNode: DynamicCodeWorkletNode;
  try {
    codeNode = await compiler(code, optimize, context);
  } catch (err) {
    console.error(err);
    setErrMessage(err.toString());
    return;
  }
  setErrMessage('');

  if (!context) {
    throw new Error(`No context found for code editor vcId ${vcId}`);
  }
  const settings = codeNode.getParamSettings(context.paramDefaultValues);

  codeNode.connect(analyzerNode);

  faustEditorContextMap[vcId] = { ...context, analyzerNode, faustNode: codeNode };
  context.reduxInfra.dispatch(
    context.reduxInfra.actionCreators.faustEditor.SET_CACHED_INPUT_NAMES(
      settings.map(R.prop('label')) as string[]
    )
  );

  // Since we now have an audio node that we can connect to things, trigger a new audio connectables to be created
  const newConnectables = get_faust_editor_connectables(vcId);
  updateConnectables(vcId, newConnectables);

  context.reduxInfra.dispatch(
    context.reduxInfra.actionCreators.faustEditor.SET_FAUST_INSTANCE(codeNode, vcId)
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
    language,
  } = useSelector(({ faustEditor }: FaustEditorReduxStore) =>
    R.pick(
      [
        'instance',
        'ControlPanelComponent',
        'editorContent',
        'isHidden',
        'polyphonyState',
        'language',
      ],
      faustEditor
    )
  );
  const [optimize, setOptimize] = useState(true);
  const [compileErrMsg, setCompileErrMsg] = useState('');
  const [controlPanelState, setControlPanelState] = useState<{ [key: string]: any }>({});
  const context = faustEditorContextMap[vcId];

  const compile = useMemo(
    () =>
      mkCompileButtonClickHandler({
        code: editorContent,
        optimize,
        setErrMessage: setCompileErrMsg,
        vcId,
        analyzerNode: context.analyzerNode,
        compiler: language === 'faust' ? compileFaustInstance : compileSoulInstance,
      }),
    [context.analyzerNode, editorContent, language, optimize, vcId]
  );
  const didCompileOnMount = useRef(false);
  useEffect(() => {
    if (context.compileOnMount && !didCompileOnMount.current) {
      didCompileOnMount.current = true;
      compile();
    }
  }, [compile, context.compileOnMount]);

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
      <ControlPanel
        state={{ language, optimize: language === 'faust' && optimize }}
        onChange={(key: string, val: any) => {
          switch (key) {
            case 'language': {
              context.reduxInfra.dispatch(
                context.reduxInfra.actionCreators.faustEditor.SET_CODE_EDITOR_LANGUAGE(val)
              );
              break;
            }
            case 'optimize': {
              setOptimize(!optimize);
              break;
            }
            default: {
              console.error('Unhandled key in faust editor settings: ', key);
            }
          }
        }}
        settings={filterNils([
          { type: 'select', label: 'language', options: ['faust', 'soul'] },
          {
            type: 'button',
            label: instance ? 'stop' : 'compile',
            action: instance ? stopInstance : compile,
          },
          language === 'faust' ? { type: 'checkbox', label: 'optimize' } : null,
        ])}
      />
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
