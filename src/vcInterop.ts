import type { VCMState } from 'src/redux/modules/viewContextManager';
import { getEngine, tryParseJson } from 'src/util';
import { initPatchNetwork } from 'src/patchNetwork';
import type { ConnectableDescriptor } from 'src/patchNetwork';
import { onVcHideStatusChange } from 'src/ViewContextManager/VcHideStatusRegistry';
import { actionCreators, dispatch, getState } from './redux';

const ctx = new AudioContext();

export const init_view_contexts = (
  activeViewContextIx: number,
  activeVcsJson: string,
  connectionsJson: string,
  foreignConnectablesJson: string
): void => {
  const activeViewContexts = tryParseJson<
    {
      minimal_def: { name: string; uuid: string; title?: string };
    }[]
  >(activeVcsJson, [], 'Failed to parse JSON of `activeViewContexts`; clearing all view contexts');

  const connections = tryParseJson<[ConnectableDescriptor, ConnectableDescriptor][]>(
    connectionsJson,
    [],
    'Failed to parse provided connections out of JSON'
  );

  const foreignConnectables = tryParseJson<{ type: string; id: string; serializedState: string }[]>(
    foreignConnectablesJson,
    [],
    'Failed to parse foreign nodes JSON; using an empty list but that will probably create invalid connections.'
  );

  dispatch(actionCreators.viewContextManager.SET_IS_LOADED(false));

  const newVCMState: Pick<VCMState, 'activeViewContextIx' | 'activeViewContexts'> & {
    foreignConnectables: { type: string; id: string; params?: { [key: string]: any } | null }[];
  } = {
    activeViewContextIx,
    activeViewContexts: activeViewContexts.map(({ minimal_def, ...rest }) => ({
      ...minimal_def,
      ...rest,
    })),
    foreignConnectables,
  };

  // Trigger a side effect of updating the patch network with the new state
  const patchNetwork = initPatchNetwork(
    getState().viewContextManager.patchNetwork,
    newVCMState.activeViewContexts,
    newVCMState.foreignConnectables,
    connections,
    ctx
  );
  dispatch(actionCreators.viewContextManager.SET_VCM_STATE(newVCMState, patchNetwork));
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

export const set_active_vc_ix = (newActiveVxIx: number) => {
  const oldActiveVcIx = getState().viewContextManager.activeViewContextIx;
  const oldActiveVcId = getState().viewContextManager.activeViewContexts[oldActiveVcIx]?.uuid;
  if (oldActiveVcId) {
    onVcHideStatusChange(oldActiveVcId, true);
  }

  const newActiveVcId = getState().viewContextManager.activeViewContexts[newActiveVxIx].uuid;
  onVcHideStatusChange(newActiveVcId, false);

  dispatch(actionCreators.viewContextManager.SET_ACTIVE_VC_IX(newActiveVxIx));
};
