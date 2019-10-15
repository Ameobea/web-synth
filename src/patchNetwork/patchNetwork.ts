import { VCMState } from 'src/redux/modules/viewContextManager';
import { getEngine } from 'src';
import { actionCreators, dispatch } from 'src/redux';

export interface AudioConnectables {
  vcId: string;
  inputs: Map<string, AudioParam | AudioNode>;
  outputs: Map<string, AudioNode>;
}

export interface ConnectableDescriptor {
  vcId: string;
  name: string;
}

export interface PatchNetwork {
  connectables: Map<string, AudioConnectables>;
  connections: [ConnectableDescriptor, ConnectableDescriptor][];
}

// The below functions are the main interface for interacting with/modifying the patch network.  They directly dispatch
// Redux actions which trigger conflict resolution, update the patch network state, perform actual connections/disconnections
// on audio nodes and params as needed, and trigger re-renders of the patch network UI.

export const connect = (from: ConnectableDescriptor, to: ConnectableDescriptor) =>
  dispatch(actionCreators.viewContextManager.CONNECT(from, to));

export const disconnect = (from: ConnectableDescriptor, to: ConnectableDescriptor) =>
  dispatch(actionCreators.viewContextManager.DISCONNECT(from, to));

export const addNode = (vcId: string, connectables: AudioConnectables, vcName: string) =>
  dispatch(actionCreators.viewContextManager.ADD_PATCH_NETWORK_NODE(vcId, connectables, vcName));

export const removeNode = (vcId: string) =>
  dispatch(actionCreators.viewContextManager.REMOVE_PATCH_NETWORK_NODE(vcId));

export const updateConnectables = (vcId: string, newConnectables: AudioConnectables) =>
  dispatch(actionCreators.viewContextManager.UPDATE_CONNECTABLES(vcId, newConnectables));

/**
 * Clear the state of the patch network, re-initializing it from scratch given the provided set of view contexts and
 * connections between them.
 */
export const initPatchNetwork = (
  oldPatchNetwork: PatchNetwork,
  viewContexts: VCMState['activeViewContexts']
): PatchNetwork => {
  const oldConnectablesMap = oldPatchNetwork.connectables;
  const newConnectablesMap = new Map();

  const engine = getEngine();
  if (!engine) {
    throw new Error('Tried to init patch network before engine handle was set');
  }

  // Diff the set of old VCs and new VCs to find which have been added and which have been removed
  console.log(viewContexts);
  viewContexts.forEach(({ uuid }) => {
    const old = oldConnectablesMap.get(uuid);
    if (old) {
      oldPatchNetwork.connectables.set(uuid, old);
      oldConnectablesMap.delete(uuid);
    } else {
      const newConnectables: AudioConnectables = engine.get_vc_connectables(uuid);
      newConnectablesMap.set(uuid, newConnectables);
      // TODO: Deal with default connections?
    }
  });

  const newConnections = oldPatchNetwork.connections.filter(([from, to]) => {
    const fromConnectables = oldConnectablesMap.get(from.vcId);
    const toConnectables = oldConnectablesMap.get(to.vcId);

    if (fromConnectables || toConnectables) {
      const fromConnectablesReal: AudioConnectables = (fromConnectables ||
        newConnectablesMap.get(from.vcId))!;
      const toConnectablesReal: AudioConnectables = (toConnectables ||
        newConnectablesMap.get(to.vcId))!;

      const src = fromConnectablesReal.outputs.get(from.name)!;
      const dst = toConnectablesReal.inputs.get(to.name)!;

      // Make TypeScript happy
      if (dst instanceof AudioParam) {
        src.disconnect(dst);
      } else {
        src.disconnect(dst);
      }

      return false;
    }

    return true;
  });

  // Disconnect any connections between nodes that have been removed
  return {
    connectables: newConnectablesMap,
    connections: [...newConnections],
  };
};

export const create_empty_audio_connectables = (vcId: string) => ({
  vcId,
  inputs: new Map(),
  outputs: new Map(),
});
