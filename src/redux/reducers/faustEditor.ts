import { FaustModuleInstance } from '../../faustEditor/FaustEditor';
import buildControlPanel, { UiGroup } from '../../faustEditor/uiBuilder';

const { WebAssembly } = window as any;

interface State {
  instance: FaustModuleInstance | null;
  controlPanel?: React.ReactNode;
  editorContent: string;
}

export const audioContext = new AudioContext();

const initialState: State = {
  instance: null,
  editorContent: '',
};

export const SET_INSTANCE = 'SET_INSTANCE';
export const CLEAR_ACTIVE_INSTANCE = 'CLEAR_ACTIVE_INSTANCE';
export const SET_EDITOR_CONTENT = 'SET_EDITOR_CONTENT';

type Action =
  | {
      type: typeof SET_INSTANCE;
      instance: typeof WebAssembly.Instance;
      dspDefProps: { ui: UiGroup[] };
    }
  | { type: typeof CLEAR_ACTIVE_INSTANCE }
  | { type: typeof SET_EDITOR_CONTENT; content: string };

export const actionCreators: { [name: string]: (...args: any[]) => Action } = {
  setActiveInstance: (instance: FaustModuleInstance, dspDefProps: { ui: UiGroup[] }) => ({
    type: SET_INSTANCE,
    instance,
    dspDefProps,
  }),
  clearActiveInstance: () => ({ type: CLEAR_ACTIVE_INSTANCE }),
  setEditorContent: (content: string) => ({ type: SET_EDITOR_CONTENT, content }),
};

const reducer = (state = initialState, action: Action) => {
  switch (action.type) {
    case SET_INSTANCE: {
      // Disconnect the old instance if there is one
      if (state.instance) {
        state.instance.disconnect();
      }

      // Construct a new control panel instance for the newly created module
      const controlPanel = buildControlPanel(action.dspDefProps.ui, action.instance.setParamValue);

      return { ...state, controlPanel, instance: action.instance };
    }

    case CLEAR_ACTIVE_INSTANCE: {
      // Disconnect the old instance if there is one
      if (state.instance) {
        state.instance.disconnect();
      }

      return { ...state, controlPanel: null, instance: null };
    }

    case SET_EDITOR_CONTENT: {
      return { ...state, editorContent: action.content };
    }

    default: {
      return state;
    }
  }
};

export default reducer;
