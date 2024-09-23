import * as R from 'ramda';
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { shallowEqual, useSelector } from 'react-redux';

import { fetchEffects, saveEffect } from 'src/api';
import { FAUST_COMPILER_ENDPOINT } from 'src/conf';
import { pickPresetWithModal } from 'src/controls/GenericPresetPicker/GenericPresetPicker';
import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import {
  faustEditorContextMap,
  get_faust_editor_connectables,
  type FaustEditorReduxInfra,
} from 'src/faustEditor';
import type { DynamicCodeWorkletNode } from 'src/faustEditor/DymanicCodeWorkletNode';
import { buildFaustWorkletNode, type FaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import { buildSoulWorkletNode } from 'src/faustEditor/SoulAudioWorklet';
import { updateConnectables } from 'src/patchNetwork/interface';
import { useWindowSize } from 'src/reactUtils';
import type { Effect } from 'src/redux/modules/effects';
import { getSentry } from 'src/sentry';
import { filterNils, type ValueOf, type Without } from 'src/util';
import { SpectrumVisualization } from 'src/visualizations/spectrum';

export type FaustEditorReduxStore = ReturnType<
  typeof faustEditorContextMap.key.reduxInfra.getState
>;

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
    color: '#e00',
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

interface MkCompileButtonClickHandlerArgs {
  setErrMessage: (errMsg: string) => void;
  vcId: string;
  analyzerNode: AnalyserNode;
  compiler?: CodeCompiler;
}

export const mkCompileButtonClickHandler =
  ({
    setErrMessage,
    vcId,
    analyzerNode,
    compiler = compileFaustInstance,
  }: MkCompileButtonClickHandlerArgs) =>
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

    if (!faustEditorContextMap[vcId]) {
      return false;
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

interface BuildCodeEditorControlPanelSettingsArgs {
  isRunning: boolean;
  language: string;
  stopInstance: () => void;
  compile: () => void;
  reduxInfra: FaustEditorReduxInfra;
  saveCode: (args: { code: string; title: string; description: string }) => void;
}

const buildCodeEditorControlPanelSettings = ({
  isRunning,
  language,
  stopInstance,
  compile,
  reduxInfra,
  saveCode,
}: BuildCodeEditorControlPanelSettingsArgs) =>
  filterNils([
    { type: 'select', label: 'language', options: ['faust', 'soul'] },
    {
      type: 'button',
      label: isRunning ? 'stop' : 'compile',
      action: isRunning
        ? () => {
            getSentry()?.captureMessage('Stopping Faust editor instance');
            stopInstance();
          }
        : () => {
            getSentry()?.captureMessage('Compiling Faust editor instance');
            compile();
          },
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
              userID: effect.userId,
              userName: effect.userName,
            }));
          });
          reduxInfra.dispatch(
            reduxInfra.actionCreators.faustEditor.SET_EDITOR_CONTENT(effect.code)
          );
        } catch (_err) {
          // pass
        }
      },
    },
  ]);

interface FaustEditorControlPanelProps {
  vcId: string;
  compile: () => Promise<boolean>;
  isRunning: boolean;
  setIsRunning: (isRunning: boolean) => void;
}

export const FaustEditorControlPanel: React.FC<FaustEditorControlPanelProps> = ({
  isRunning,
  setIsRunning,
  vcId,
  compile,
}) => {
  const context = faustEditorContextMap[vcId];

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
      buildCodeEditorControlPanelSettings({
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
    [compile, context.reduxInfra, isRunning, language, saveCode, setIsRunning, stopInstance]
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

interface FaustEditorProps {
  vcId: string;
}

const FaustEditor: React.FC<FaustEditorProps> = ({ vcId }) => {
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

  const context = faustEditorContextMap[vcId];
  const [isRunning, setIsRunning] = useState(!!context.faustNode);
  const [compileErrMsg, setCompileErrMsg] = useState('');
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
      compile().then(() => setIsRunning(true));
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
      <FaustEditorControlPanel
        vcId={vcId}
        compile={compile}
        isRunning={isRunning}
        setIsRunning={setIsRunning}
      />

      {FaustInstanceControlPanelComponent ? <FaustInstanceControlPanelComponent /> : null}

      <SpectrumVisualization
        paused={isHidden}
        analyzerNode={context.analyzerNode}
        height={(windowSize.height - 34 - 500 - 2) * 2}
        canvasStyle={styles.spectrumVizStyle}
        controlPanelDraggable={false}
      />
    </Suspense>
  );
};

export default FaustEditor;
