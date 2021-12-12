import React, { useState, Suspense, useMemo, useRef, useEffect, useCallback } from 'react';
import { shallowEqual, useSelector } from 'react-redux';
import ControlPanel from 'react-control-panel';
import * as R from 'ramda';
import { Without, ValueOf, filterNils, useWindowSize } from 'ameo-utils';

import { Effect } from 'src/redux/modules/effects';
import { FAUST_COMPILER_ENDPOINT } from 'src/conf';
import { SpectrumVisualization } from 'src/visualizations/spectrum';
import { FaustWorkletNode, buildFaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import {
  faustEditorContextMap,
  FaustEditorReduxInfra,
  get_faust_editor_connectables,
} from 'src/faustEditor';
import { updateConnectables } from 'src/patchNetwork/interface';
import { fetchEffects, saveEffect } from 'src/api';
import { DynamicCodeWorkletNode } from 'src/faustEditor/DymanicCodeWorkletNode';
import { buildSoulWorkletNode } from 'src/faustEditor/SoulAudioWorklet';
import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import { pickPresetWithModal } from 'src/controls/GenericPresetPicker/GenericPresetPicker';

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
  controlPanel: {
    position: 'absolute',
  },
  spectrumVizStyle: {
    marginBottom: -23,
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

type CodeCompiler = (
  code: string,
  optimize: boolean,
  context: ValueOf<typeof faustEditorContextMap>
) => Promise<DynamicCodeWorkletNode>;

export const mkCompileButtonClickHandler =
  ({
    setErrMessage,
    vcId,
    analyzerNode,
    compiler = compileFaustInstance,
  }: {
    setErrMessage: (errMsg: string) => void;
    vcId: string;
    analyzerNode: AnalyserNode;
    compiler?: CodeCompiler;
  }) =>
  async (): Promise<boolean> => {
    const context = faustEditorContextMap[vcId];
    let codeNode: DynamicCodeWorkletNode;
    try {
      const { editorContent: code, optimize } = context.reduxInfra.getState().faustEditor;
      codeNode = await compiler(code, optimize ?? false, context);
    } catch (err) {
      console.error(err);
      setErrMessage(`${err}`);
      return false;
    }
    setErrMessage('');

    if (!context) {
      throw new Error(`No context found for code editor vcId ${vcId}`);
    }
    const settings = codeNode.getParamSettings(context.paramDefaultValues);

    codeNode.connect(analyzerNode);

    faustEditorContextMap[vcId].analyzerNode = analyzerNode;
    faustEditorContextMap[vcId].faustNode = codeNode;
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
    return true;
  };

/**
 * Returns a function that stops the currently running Faust editor instance, setting Redux and `faustEditorContextMap`
 * to reflect this new state;
 */
export const mkStopInstanceHandler = (vcId: string) => () => {
  const context = faustEditorContextMap[vcId];
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

const buildFaustEditorControlPanelSettings = ({
  isRunning,
  language,
  stopInstance,
  compile,
  reduxInfra,
  saveCode,
}: {
  isRunning: boolean;
  language: string;
  stopInstance: () => void;
  compile: () => void;
  reduxInfra: FaustEditorReduxInfra;
  saveCode: (args: { code: string; title: string; description: string }) => void;
}) =>
  filterNils([
    { type: 'select', label: 'language', options: ['faust', 'soul'] },
    {
      type: 'button',
      label: isRunning ? 'stop' : 'compile',
      action: isRunning ? stopInstance : compile,
    },
    language === 'faust' ? { type: 'checkbox', label: 'optimize' } : null,
    {
      type: 'button',
      label: 'save program',
      action: async () => {
        try {
          const { name, description } = await renderGenericPresetSaverWithModal({
            description: true,
          });
          const code = reduxInfra.getState().faustEditor.editorContent;
          saveCode({ code, title: name, description: description ?? '' });
        } catch (_err) {
          // pass
        }
      },
    },
    {
      type: 'button',
      label: 'load program',
      action: async () => {
        try {
          const { preset: effect } = await pickPresetWithModal(async () => {
            const effects = await fetchEffects();
            return effects.map(effect => ({
              id: effect.id,
              name: effect.title,
              description: effect.description,
              preset: effect,
            }));
          });
          reduxInfra.dispatch(
            reduxInfra.actionCreators.faustEditor.SET_EDITOR_CONTENT(effect.code)
          );
        } catch (err) {
          // pass
        }
      },
    },
  ]);

interface FaustEditorControlPanelProps {
  vcId: string;
  compile: () => Promise<boolean>;
}

const FaustEditorControlPanel: React.FC<FaustEditorControlPanelProps> = ({ vcId, compile }) => {
  const context = faustEditorContextMap[vcId];
  const [isRunning, setIsRunning] = useState(!!context.faustNode);
  const { language, optimize } = useSelector(
    ({ faustEditor }: FaustEditorReduxStore) => R.pick(['language', 'optimize'], faustEditor),
    shallowEqual
  );

  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const stopInstance = useMemo(() => mkStopInstanceHandler(vcId), [vcId]);
  const saveCode = useCallback(async (effect: Without<Effect, 'id'>) => {
    try {
      await saveEffect(effect);
      setSaveStatus('Successfully saved!');
    } catch (err) {
      console.error('Error saving effect: ', err);
    }
  }, []);

  const settings = useMemo(
    () =>
      buildFaustEditorControlPanelSettings({
        isRunning,
        language,
        stopInstance: () => {
          setIsRunning(false);
          stopInstance();
        },
        compile: () => {
          compile()
            .then(setIsRunning)
            .catch(() => setIsRunning(false));
        },
        saveCode,
        reduxInfra: context.reduxInfra,
      }),
    [compile, context.reduxInfra, isRunning, language, saveCode, stopInstance]
  );

  const onChange = useCallback(
    (key: string, val: any) => {
      switch (key) {
        case 'language': {
          context.reduxInfra.dispatch(
            context.reduxInfra.actionCreators.faustEditor.SET_CODE_EDITOR_LANGUAGE(val)
          );
          break;
        }
        case 'optimize': {
          context.reduxInfra.dispatch(
            context.reduxInfra.actionCreators.faustEditor.FAUST_EDITOR_TOGGLE_OPTIMIZE()
          );
          break;
        }
        default: {
          console.error('Unhandled key in faust editor settings: ', key);
        }
      }
    },
    [context.reduxInfra]
  );
  const controlPanelState = useMemo(
    () => ({ language, optimize: language === 'faust' && optimize }),
    [language, optimize]
  );

  return (
    <>
      <ControlPanel
        state={controlPanelState}
        onChange={onChange}
        settings={settings}
        style={styles.controlPanel}
      />
      {saveStatus ? <>{saveStatus}</> : null}
    </>
  );
};

const FaustEditor: React.FC<{ vcId: string }> = ({ vcId }) => {
  const {
    ControlPanelComponent: FaustInstanceControlPanelComponent,
    editorContent,
    isHidden,
    language,
  } = useSelector(
    ({ faustEditor }: FaustEditorReduxStore) =>
      R.pick(['ControlPanelComponent', 'editorContent', 'isHidden', 'language'], faustEditor),
    shallowEqual
  );
  const windowSize = useWindowSize();

  const [compileErrMsg, setCompileErrMsg] = useState('');
  const context = faustEditorContextMap[vcId];
  const compile = useMemo(
    () =>
      mkCompileButtonClickHandler({
        setErrMessage: setCompileErrMsg,
        vcId,
        analyzerNode: context.analyzerNode,
        compiler: language === 'faust' ? compileFaustInstance : compileSoulInstance,
      }),
    [context.analyzerNode, language, vcId]
  );

  const didCompileOnMount = useRef(false);
  useEffect(() => {
    if (context.compileOnMount && !didCompileOnMount.current) {
      didCompileOnMount.current = true;
      compile();
    }
  }, [compile, context.compileOnMount]);

  return (
    <Suspense fallback={<span>Loading...</span>}>
      <div style={styles.root}>
        <CodeEditor
          onChange={useCallback(
            newValue =>
              context.reduxInfra.dispatch(
                context.reduxInfra.actionCreators.faustEditor.SET_EDITOR_CONTENT(newValue)
              ),
            [context.reduxInfra]
          )}
          value={editorContent}
        />

        <div style={styles.errorConsole}>{compileErrMsg}</div>
      </div>
      <FaustEditorControlPanel vcId={vcId} compile={compile} />

      {FaustInstanceControlPanelComponent ? <FaustInstanceControlPanelComponent /> : null}

      <SpectrumVisualization
        paused={isHidden}
        analyzerNode={context.analyzerNode}
        height={windowSize.height - 34 - 500 - 2}
        canvasStyle={styles.spectrumVizStyle}
        controlPanelDraggable={false}
      />
    </Suspense>
  );
};

export default FaustEditor;
