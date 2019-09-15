import { buildActionGroup, buildModule } from 'jantix';

export interface VCMState {
  activeViewContexts: { name: string; uuid: string; title?: string }[];
  activeViewContextIx: number;
}

const actionGroups = {
  SET_VCM_STATE: buildActionGroup({
    actionCreator: (state: VCMState) => ({ type: 'SET_VCM_STATE', state }),
    subReducer: (_state: VCMState, { state }) => state,
  }),
};

export default buildModule<VCMState, typeof actionGroups>(
  {
    activeViewContexts: [],
    activeViewContextIx: 0,
  },
  actionGroups
);
