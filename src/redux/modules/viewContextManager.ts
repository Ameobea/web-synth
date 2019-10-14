import { buildActionGroup, buildModule } from 'jantix';

import { initPatchNetwork } from 'src/patchNetwork/patchNetwork';

export interface VCMState {
  activeViewContexts: { name: string; uuid: string; title?: string }[];
  activeViewContextIx: number;
}

const actionGroups = {
  SET_VCM_STATE: buildActionGroup({
    actionCreator: (newState: VCMState) => ({ type: 'SET_VCM_STATE', newState }),
    subReducer: (_state: VCMState, { newState }) => {
      // Trigger a side effect of updating the patch network with the new state

      return newState;
    },
  }),
};

const initialState: VCMState = {
  activeViewContexts: [],
  activeViewContextIx: 0,
};

export default buildModule<VCMState, typeof actionGroups>(initialState, actionGroups);
