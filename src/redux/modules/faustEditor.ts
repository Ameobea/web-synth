import { buildActionGroup, buildModule } from 'jantix';

import { FaustModuleInstance } from 'src/faustEditor/FaustEditor';
import buildControlPanel from 'src/faustEditor/uiBuilder';

interface FaustEditorState {
  instance: FaustModuleInstance | null;
  controlPanel?: React.ReactNode;
  editorContent: string;
}

const initialState: FaustEditorState = {
  instance: null,
  editorContent: '',
};

const actionGroups = {
  SET_INSTANCE: buildActionGroup({
    actionCreator: (instance: FaustModuleInstance) => ({
      type: 'SET_INSTANCE',
      instance,
    }),
    subReducer: (state: FaustEditorState, action) => {
      // Disconnect the old instance if there is one
      if (state.instance) {
        state.instance.disconnect();
      }

      // Construct a new control panel instance for the newly created module
      const controlPanel = buildControlPanel(
        action.instance.jsonDef.ui,
        action.instance.pathTable,
        action.instance.setParamValue
      );

      return { ...state, controlPanel, instance: action.instance };
    },
  }),
  CLEAR_ACTIVE_INSTANCE: buildActionGroup({
    actionCreator: () => ({ type: 'CLEAR_ACTIVE_INSTANCE' }),
    subReducer: (state: FaustEditorState) => {
      // Disconnect the old instance if there is one
      if (state.instance) {
        state.instance.disconnect();
      }

      return { ...state, controlPanel: null, instance: null };
    },
  }),
  SET_EDITOR_CONTENT: buildActionGroup({
    actionCreator: (content: string) => ({ type: 'SET_EDITOR_CONTENT', content }),
    subReducer: (state: FaustEditorState, { content }) => ({ ...state, editorContent: content }),
  }),
};

export default buildModule<FaustEditorState, typeof actionGroups>(initialState, actionGroups);
