import { buildActionGroup, buildModule } from 'jantix';

import { initPatchNetwork, PatchNetwork } from 'src/patchNetwork/patchNetwork';

export interface VCMState {
  activeViewContexts: { name: string; uuid: string; title?: string }[];
  activeViewContextIx: number;
  patchNetwork: PatchNetwork;
}

const actionGroups = {
  SET_VCM_STATE: buildActionGroup({
    actionCreator: (newState: Pick<VCMState, 'activeViewContextIx' | 'activeViewContexts'>) => ({
      type: 'SET_VCM_STATE',
      newState,
    }),
    subReducer: (state: VCMState, { newState }) => {
      // Trigger a side effect of updating the patch network with the new state
      const newPatchNetwork = initPatchNetwork(state.patchNetwork, newState.activeViewContexts);

      return { ...newState, patchNetwork: newPatchNetwork };
    },
  }),
};

const initialState: VCMState = {
  activeViewContexts: [],
  activeViewContextIx: 0,
  patchNetwork: {
    connectables: new Map(),
    connections: [],
  },
};

export default buildModule<VCMState, typeof actionGroups>(initialState, actionGroups);
