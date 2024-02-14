import { initPatchNetwork } from 'src/patchNetwork';
import type {
  ConnectableDescriptor,
  ForeignConnectable,
  SubgraphDescriptor,
} from 'src/patchNetwork';
import { initializeDefaultVCMState } from 'src/redux/modules/vcmUtils';
import type { VCMState } from 'src/redux/modules/viewContextManager';
import type { SampleDescriptor } from 'src/sampleLibrary';
import { getEngine, tryParseJson } from 'src/util';
import { onVcHideStatusChange } from 'src/ViewContextManager/VcHideStatusRegistry';
import { actionCreators, dispatch, getState } from './redux';
import { audioNodeGetters, buildNewForeignConnectableID } from 'src/graphEditor/nodes/CustomAudio';

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

  const foreignConnectables = tryParseJson<ForeignConnectable[]>(
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
    'activeViewContextId' | 'activeViewContexts' | 'subgraphsByID' | 'foreignConnectables'
  > = {
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
    foreignConnectables,
    connections,
    ctx
  );
  dispatch(
    actionCreators.viewContextManager.SET_VCM_STATE(newVCMState, patchNetwork, activeSubgraphID)
  );
};

export const add_view_context = (id: string, name: string, subgraphID: string) => {
  const engine = getEngine()!; // Must exist because this gets called *from the engine*.
  dispatch(actionCreators.viewContextManager.ADD_VIEW_CONTEXT(id, name, subgraphID));
  dispatch(
    actionCreators.viewContextManager.ADD_PATCH_NETWORK_NODE(
      id,
      engine.get_vc_connectables(id),
      subgraphID
    )
  );
};

export const add_foreign_connectable = (fcJSON: string): string => {
  const fc: ForeignConnectable = JSON.parse(fcJSON);
  const id = buildNewForeignConnectableID().toString();
  const node = new audioNodeGetters[fc.type]!.nodeGetter(ctx, id, fc.serializedState);
  const connectables = node.buildConnectables();
  dispatch(
    actionCreators.viewContextManager.ADD_PATCH_NETWORK_NODE(id, connectables, fc.subgraphId)
  );
  return id;
};

/**
 * Sets connections to match the engine.
 *
 * Does _NOT_ perform any actual connection/disconnection operations; it assumes that
 * the patch network state already matches the provided list.
 */
export const set_connections = (connectionsJson: string) => {
  const connections = tryParseJson<[ConnectableDescriptor, ConnectableDescriptor][]>(
    connectionsJson,
    [],
    'Failed to parse provided connections out of JSON'
  );
  dispatch(actionCreators.viewContextManager.SET_CONNECTIONS(connections));
};

export const set_foreign_connectables = (foreignConnectablesJson: string) => {
  const foreignConnectables = tryParseJson<ForeignConnectable[]>(
    foreignConnectablesJson,
    [],
    'Failed to parse foreign nodes JSON; using an empty list but that will probably create invalid connections.'
  );
  dispatch(actionCreators.viewContextManager.SET_FOREIGN_CONNECTABLES(foreignConnectables));
};

export const set_view_contexts = (activeViewContextId: string, activeViewContextsJson: string) => {
  const activeViewContexts = tryParseJson<
    { name: string; uuid: string; title?: string; subgraphId: string }[]
  >(
    activeViewContextsJson,
    [],
    'Failed to parse JSON of `activeViewContexts`; clearing all view contexts'
  );
  dispatch(
    actionCreators.viewContextManager.SET_VIEW_CONTEXTS(activeViewContextId, activeViewContexts)
  );
};

export const add_connection = (
  fromVcId: string,
  fromPortName: string,
  toVcId: string,
  toPortName: string
) => {
  dispatch(
    actionCreators.viewContextManager.CONNECT(
      { vcId: fromVcId, name: fromPortName },
      { vcId: toVcId, name: toPortName }
    )
  );
};

export const delete_connection = (
  fromVcId: string,
  fromPortName: string,
  toVcId: string,
  toPortName: string
) => {
  dispatch(
    actionCreators.viewContextManager.DISCONNECT(
      { vcId: fromVcId, name: fromPortName },
      { vcId: toVcId, name: toPortName }
    )
  );
};

export const delete_foreign_connectable = (id: string) => {
  dispatch(actionCreators.viewContextManager.REMOVE_PATCH_NETWORK_NODE(id));
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

export const set_subgraphs = (activeSubgraphID: string, subgraphsByIdJSON: string) => {
  const subgraphsByID = tryParseJson<{ [subgraphID: string]: SubgraphDescriptor }>(
    subgraphsByIdJSON,
    {},
    'Failed to parse subgraphs JSON; using an empty list but that will probably create invalid connections.'
  );
  dispatch(actionCreators.viewContextManager.SET_SUBGRAPHS(activeSubgraphID, subgraphsByID));
};

export const set_vc_title = (id: string, title: string) => {
  dispatch(actionCreators.viewContextManager.SET_VC_TITLE(id, title));
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
