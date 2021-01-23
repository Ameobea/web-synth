import { buildActionGroup, buildModule, buildStore as buildJantixStore } from 'jantix';

import buildControlPanelComponent from 'src/faustEditor/uiBuilder';
import { faustEditorContextMap } from 'src/faustEditor';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { DynamicCodeWorkletNode } from 'src/faustEditor/DymanicCodeWorkletNode';

/**
 * Structure of the JSON stored in `localStorage` for the Faust editor.
 */
export interface SerializedFaustEditor {
  cachedInputNames: string[] | undefined;
  editorContent: string;
  polyphonyState: FaustEditorPolyphonyState;
  paramDefaultValues?: { [paramName: string]: number };
  isRunning: boolean;
  language?: CodeEditorLanguage;
}

export interface FaustEditorPolyphonyState {
  polyphonyEnabled: boolean;
  frequencyInputName: string | null;
  gateInputName: string | null;
  voiceCount: number;
}

export const buildDefaultFaustEditorPolyphonyState = (): FaustEditorPolyphonyState => ({
  polyphonyEnabled: false,
  frequencyInputName: null,
  gateInputName: null,
  voiceCount: 8,
});

export type CodeEditorLanguage = 'faust' | 'soul';

export interface FaustEditorState {
  instance: DynamicCodeWorkletNode | null;
  ControlPanelComponent?: React.FC<{
    style?: React.CSSProperties;
    position?: any;
    draggable?: boolean;
  }>;
  editorContent: string;
  isHidden: boolean;
  polyphonyState: FaustEditorPolyphonyState;
  cachedInputNames: string[] | undefined;
  language: CodeEditorLanguage;
}

const buildInitialState = (): FaustEditorState => ({
  instance: null,
  editorContent: '',
  isHidden: false,
  polyphonyState: buildDefaultFaustEditorPolyphonyState(),
  cachedInputNames: undefined,
  language: 'faust',
});

const getFaustModuleParam = (vcId: string, path: string): OverridableAudioParam | undefined => {
  const context = faustEditorContextMap[vcId];
  if (!context) {
    console.error(`No code editor context found for vcId "${vcId}"`);
    return;
  }

  return context.overrideableParams[path];
};

const actionGroups = {
  SET_FAUST_INSTANCE: buildActionGroup({
    actionCreator: (instance: DynamicCodeWorkletNode, vcId: string) => ({
      type: 'SET_FAUST_INSTANCE',
      instance,
      vcId,
    }),
    subReducer: (state: FaustEditorState, { instance, vcId }) => {
      const setParamValue = (path: string, val: number) => {
        const dstParam = getFaustModuleParam(vcId, path);
        if (!dstParam) {
          console.warn(`Param doesn't exist: "${path}"`);
          return;
        }

        dstParam.manualControl.offset.value = +val;
      };

      // Construct a new control panel instance for the newly created module
      const ControlPanelComponent = buildControlPanelComponent(
        instance,
        setParamValue,
        faustEditorContextMap[vcId]?.paramDefaultValues ?? {}
      );

      return { ...state, instance, ControlPanelComponent };
    },
  }),
  CLEAR_ACTIVE_INSTANCE: buildActionGroup({
    actionCreator: () => ({ type: 'CLEAR_ACTIVE_INSTANCE' }),
    subReducer: (state: FaustEditorState) => ({ ...state, controlPanel: null, instance: null }),
  }),
  SET_EDITOR_CONTENT: buildActionGroup({
    actionCreator: (content: string) => ({ type: 'SET_EDITOR_CONTENT', content }),
    subReducer: (state: FaustEditorState, { content }) => ({ ...state, editorContent: content }),
  }),
  SET_IS_HIDDEN: buildActionGroup({
    actionCreator: (isHidden: boolean) => ({ type: 'SET_IS_HIDDEN', isHidden }),
    subReducer: (state: FaustEditorState, { isHidden }) => ({ ...state, isHidden }),
  }),
  SET_POLYPHONY_STATE: buildActionGroup({
    actionCreator: (newState: FaustEditorPolyphonyState) => ({
      type: 'SET_POLYPHONY_STATE',
      newState,
    }),
    subReducer: (state: FaustEditorState, { newState }) => ({ ...state, polyphonyState: newState }),
  }),
  SET_CACHED_INPUT_NAMES: buildActionGroup({
    actionCreator: (cachedInputNames: string[] | undefined) => ({
      type: 'SET_CACHED_INPUT_NAMES',
      cachedInputNames,
    }),
    subReducer: (state: FaustEditorState, { cachedInputNames }) => ({ ...state, cachedInputNames }),
  }),
  SET_CODE_EDITOR_LANGUAGE: buildActionGroup({
    actionCreator: (language: CodeEditorLanguage) => ({
      type: 'SET_CODE_EDITOR_LANGUAGE',
      language,
    }),
    subReducer: (state: FaustEditorState, { language }) => ({ ...state, language }),
  }),
};

export const buildFaustEditorReduxInfra = (serialized: SerializedFaustEditor) => {
  const initialState = {
    ...buildInitialState(),
    ...serialized,
    language: serialized.language ?? 'faust',
  };

  const faustEditorModule = buildModule<FaustEditorState, typeof actionGroups>(
    initialState,
    actionGroups
  );
  const modules = { faustEditor: faustEditorModule };

  return buildJantixStore<typeof modules>(modules);
};
