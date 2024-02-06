import { initPatchNetwork } from 'src/patchNetwork';
import type { ConnectableDescriptor, SubgraphDescriptor } from 'src/patchNetwork';
import { initializeDefaultVCMState } from 'src/redux/modules/vcmUtils';
import type { VCMState } from 'src/redux/modules/viewContextManager';
import type { SampleDescriptor } from 'src/sampleLibrary';
import { getEngine, tryParseJson } from 'src/util';
import { onVcHideStatusChange } from 'src/ViewContextManager/VcHideStatusRegistry';
import { actionCreators, dispatch, getState } from './redux';

const ctx = new AudioContext();

export const init_view_contexts = (
  activeViewContextId: string,
  activeVcsJson: string,
  connectionsJson: string,
  foreignConnectablesJson: string,
  activeSubgraphID: string,
  subgraphsJson: string
): void => {
  const activeViewContexts = tryParseJson<
    {
      minimal_def: { name: string; uuid: string; title?: string; subgraphId: string };
    }[]
  >(activeVcsJson, [], 'Failed to parse JSON of `activeViewContexts`; clearing all view contexts');

  const connections = tryParseJson<[ConnectableDescriptor, ConnectableDescriptor][]>(
    connectionsJson,
    [],
    'Failed to parse provided connections out of JSON'
  );

  const foreignConnectables = tryParseJson<
    { type: string; id: string; subgraphId: string; serializedState: string }[]
  >(
    foreignConnectablesJson,
    [],
    'Failed to parse foreign nodes JSON; using an empty list but that will probably create invalid connections.'
  );

  const subgraphsByID: { [id: string]: SubgraphDescriptor } = tryParseJson(
    subgraphsJson,
    {},
    'Failed to parse subgraphs JSON; using an empty list but that will probably create invalid connections.'
  );

  dispatch(actionCreators.viewContextManager.SET_IS_LOADED(false));

  const newVCMState: Pick<
    VCMState,
    'activeViewContextId' | 'activeViewContexts' | 'subgraphsByID'
  > & {
    foreignConnectables: {
      type: string;
      id: string;
      subgraphId: string;
      params?: { [key: string]: any } | null;
    }[];
  } = {
    activeViewContextId,
    activeViewContexts: activeViewContexts.map(({ minimal_def, ...rest }) => ({
      ...minimal_def,
      ...rest,
    })),
    foreignConnectables,
    subgraphsByID,
  };

  // Trigger a side effect of updating the patch network with the new state
  const patchNetwork = initPatchNetwork(
    getState().viewContextManager.patchNetwork,
    newVCMState.activeViewContexts,
    newVCMState.foreignConnectables,
    connections,
    ctx
  );
  dispatch(
    actionCreators.viewContextManager.SET_VCM_STATE(newVCMState, patchNetwork, activeSubgraphID)
  );
};

export const add_view_context = (id: string, name: string) => {
  const engine = getEngine()!; // Must exist because this gets called *from the engine*.
  dispatch(actionCreators.viewContextManager.ADD_VIEW_CONTEXT(id, name));
  dispatch(
    actionCreators.viewContextManager.ADD_PATCH_NETWORK_NODE(id, engine.get_vc_connectables(id))
  );
};

export const delete_view_context = (id: string) => {
  dispatch(actionCreators.viewContextManager.REMOVE_PATCH_NETWORK_NODE(id));
  dispatch(actionCreators.viewContextManager.DELETE_VIEW_CONTEXT(id));
};

export const set_active_vc_id = (newActiveVcId: string) => {
  const oldActiveVcId = getState().viewContextManager.activeViewContextId;
  if (oldActiveVcId === newActiveVcId) {
    return;
  }
  if (oldActiveVcId) {
    onVcHideStatusChange(oldActiveVcId, true);
  }

  onVcHideStatusChange(newActiveVcId, false);

  dispatch(actionCreators.viewContextManager.SET_ACTIVE_VC_ID(newActiveVcId));
};

export const list_foreign_node_used_samples = (id: string): SampleDescriptor[] => {
  const connectables = getState().viewContextManager.patchNetwork.connectables.get(id);
  if (!connectables) {
    console.error(`Foreign node connectables with ID ${id} not found.`);
    return [];
  }

  if (!connectables.node) {
    console.error(`Foreign node with ID ${id} connectables has no node.`);
    return [];
  }

  return connectables.node.listUsedSamples?.() ?? [];
};

export const initialize_default_vcm_state = () => {
  if (localStorage.vcmState) {
    console.warn('VCM state already set in localStorage when trying to initialize default state');
  }
  initializeDefaultVCMState();
};
