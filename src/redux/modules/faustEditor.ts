import { buildActionGroup, buildModule } from 'jantix';

import buildControlPanelComponent from 'src/faustEditor/uiBuilder';
import { FaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import { faustEditorContextMap } from 'src/faustEditor';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';

interface FaustEditorState {
  instance: FaustWorkletNode | null;
  ControlPanelComponent?: React.ComponentType<{}>;
  editorContent: string;
}

const initialState: FaustEditorState = {
  instance: null,
  editorContent: '',
};

const getFaustModuleParam = (vcId: string, path: string): OverridableAudioParam | undefined => {
  const context = faustEditorContextMap[vcId];
  if (!context) {
    console.error(`No Faust Editor context found for vcId "${vcId}"`);
    return;
  }

  const dstParam = context.overrideableParams[path];
  if (!dstParam) {
    console.error(`No param exists at path ${path} for Faust editor vcId "${vcId}"`);
  }

  return dstParam;
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
      const ControlPanelComponent = buildControlPanelComponent(
        instance.jsonDef.ui,
        instance.pathTable,
        (path: string, val: number) => {
          const dstParam = getFaustModuleParam(vcId, path);
          if (!dstParam) {
            return;
          }

          dstParam.manualControl.offset.value = val;
        },
        (path: string) => {
          const dstParam = getFaustModuleParam(vcId, path);
          if (!dstParam) {
            return;
          }

          return dstParam.manualControl.offset.value;
        }
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
};

export default buildModule<FaustEditorState, typeof actionGroups>(initialState, actionGroups);
