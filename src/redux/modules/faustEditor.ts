import { buildActionGroup, buildModule } from 'jantix';

import buildControlPanel from 'src/faustEditor/uiBuilder';
import { FaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';

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
      // idiot typescript  \/
      // eslint-disable-next-line @typescript-eslint/no-inferrable-types
      noBuildControlPanel: boolean = false
    ): { type: 'SET_INSTANCE'; instance: FaustWorkletNode; noBuildControlPanel: boolean } => ({
      type: 'SET_INSTANCE',
      instance,
      noBuildControlPanel,
    }),
    subReducer: (state: FaustEditorState, { instance, noBuildControlPanel }) => {
      const newState = { ...state, instance };
      if (!noBuildControlPanel) {
        // Construct a new control panel instance for the newly created module
        state.controlPanel = buildControlPanel(
          instance.jsonDef.ui,
          instance.pathTable,
          instance.setParamValue
        );
      }

      return newState;
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
