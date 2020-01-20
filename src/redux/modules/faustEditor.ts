import { buildActionGroup, buildModule } from 'jantix';

import buildControlPanel from 'src/faustEditor/uiBuilder';
import { FaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import { faustEditorContextMap } from 'src/faustEditor';

interface FaustEditorState {
  instance: FaustWorkletNode | null;
  controlPanel?: React.ReactNode;
  editorContent: string;
}

const initialState: FaustEditorState = {
  instance: null,
  editorContent: '',
};

const actionGroups = {
  SET_INSTANCE: buildActionGroup({
    actionCreator: (
      instance: FaustWorkletNode,
      vcId: string
    ): { type: 'SET_INSTANCE'; instance: FaustWorkletNode; vcId: string } => ({
      type: 'SET_INSTANCE',
      instance,
      vcId,
    }),
    subReducer: (state: FaustEditorState, { instance, vcId }) => {
      // Construct a new control panel instance for the newly created module
      const controlPanel = buildControlPanel(
        instance.jsonDef.ui,
        instance.pathTable,
        (path: string, val: number) => {
          const context = faustEditorContextMap[vcId];
          if (!context) {
            console.error(`No Faust Editor context found for vcId "${vcId}"`);
            return state;
          }

          const dstParam = context.overrideableParams[path];
          if (!dstParam) {
            console.error(`No param exists at path ${path} for Faust editor vcId "${vcId}"`);
            return;
          }

          dstParam.manualControl.offset.value = val;
        }
      );

      return { ...state, instance, controlPanel };
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
};

export default buildModule<FaustEditorState, typeof actionGroups>(initialState, actionGroups);
