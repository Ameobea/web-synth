import * as R from 'ramda';
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { shallowEqual, useSelector } from 'react-redux';

import { fetchEffects, getEffect, saveEffect } from 'src/api';
import { pickPresetWithModal } from 'src/controls/GenericPresetPicker/GenericPresetPicker';
import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import { faustEditorContextMap, type FaustEditorReduxInfra } from 'src/faustEditor';
import {
  compileFaustInstance,
  compileSoulInstance,
  mkCompileButtonClickHandler,
  mkStopInstanceHandler,
} from 'src/faustEditor/compileHandlers';
import { useWindowSize } from 'src/reactUtils';
import type { Effect } from 'src/redux/modules/effects';
import { getSentry, logError } from 'src/sentry';
import { filterNils } from 'src/util';
import { SpectrumVisualization } from 'src/visualizations/spectrum';

export type FaustEditorReduxStore = ReturnType<
  typeof faustEditorContextMap.key.reduxInfra.getState
>;

const CodeEditor = React.lazy(() => import('./CodeEditor'));

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
        let effectId: number;
        try {
          ({ preset: effectId } = await pickPresetWithModal(async () => {
            const effects = await fetchEffects();
            return effects.map(effect => ({
              id: effect.id,
              name: effect.title,
              description: effect.description,
              preset: effect.id,
              userID: effect.userId,
              userName: effect.userName,
              isFeatured: effect.isFeatured,
            }));
          }));
        } catch (_err) {
          return; // cancelled
        }

        try {
          const effect = await getEffect(effectId);
          reduxInfra.dispatch(reduxInfra.actionCreators.faustEditor.SET_EDITOR_CONTENT(effect.code));
        } catch (err) {
          logError('Error fetching effect', err);
          toastError(`Error fetching effect: ${err}`);
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
  const saveCode = useCallback(async (effect: Omit<Effect, 'id'>) => {
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
