import { buildActionGroup, buildModule } from 'jantix';

export interface VCMState {
  activeViewContexts: { name: string; uuid: string; title?: string }[];
  activeViewContextIx: number;
}

const actionGroups = {
  SET_VCM_STATE: buildActionGroup({
    actionCreator: (newState: VCMState) => ({ type: 'SET_VCM_STATE', newState }),
    subReducer: (_state: VCMState, { newState }) => newState,
  }),
};

const initialState: VCMState = {
  activeViewContexts: [],
  activeViewContextIx: 0,
};

export default buildModule<VCMState, typeof actionGroups>(initialState, actionGroups);
