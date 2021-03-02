import { buildActionGroup, buildModule } from 'jantix';

export interface UploadedMusicXML {
  fileName: string;
  fileContent: string;
}

export interface SinsyState {
  selectedHtsVoice: string | null;
  musicXml: UploadedMusicXML | null | null;
}

export type SinsyRootState = {
  sinsyModule: { [key: string]: any } | null;
  instances: { [vcId: string]: SinsyState };
};

export const buildDefaultSinsyState = (): SinsyState => ({
  selectedHtsVoice: null,
  musicXml: null,
});

const getSinsyState = (rootState: SinsyRootState, vcId: string): SinsyState | undefined => {
  const state = rootState.instances[vcId];
  if (!state) {
    console.error('Sinsy action targeted state with missing');
  }
  return state;
};

const setSinsyState = (rootState: SinsyRootState, vcId: string, newState: SinsyState) => ({
  ...rootState,
  instances: { ...rootState.instances, [vcId]: newState },
});

const actionGroups = {
  SET_SINSY_STATE: buildActionGroup({
    actionCreator: (vcId: string, state: SinsyState) => ({ type: 'SET_SINSY_STATE', vcId, state }),
    subReducer: (rootState: SinsyRootState, { vcId, state }) =>
      setSinsyState(rootState, vcId, state),
  }),
  SET_SELECTED_HTS_VOICE: buildActionGroup({
    actionCreator: (vcId: string, selectedHtsVoice: string | null) => ({
      type: 'SET_SELECTED_HTS_VOICE',
      vcId,
      selectedHtsVoice,
    }),
    subReducer: (rootState: SinsyRootState, { vcId, selectedHtsVoice }) => {
      const state = getSinsyState(rootState, vcId);
      if (!state) {
        return rootState;
      }

      return setSinsyState(rootState, vcId, { ...state, selectedHtsVoice });
    },
  }),
  SET_SINSY_MUSICXML: buildActionGroup({
    actionCreator: (vcId: string, musicXml: UploadedMusicXML | null) => ({
      type: 'SET_SINSY_MUSICXML',
      vcId,
      musicXml,
    }),
    subReducer: (rootState: SinsyRootState, { vcId, musicXml }) => {
      const state = getSinsyState(rootState, vcId);
      if (!state) {
        return rootState;
      }

      return setSinsyState(rootState, vcId, { ...state, musicXml });
    },
  }),
  SET_SINSY_MODULE: buildActionGroup({
    actionCreator: (sinsyModule: any) => ({ type: 'SET_SINSY_MODULE', sinsyModule }),
    subReducer: (state: SinsyRootState, { sinsyModule }) => ({ ...state, sinsyModule }),
  }),
};

export default buildModule<SinsyRootState, typeof actionGroups>(
  { sinsyModule: null, instances: {} },
  actionGroups
);
