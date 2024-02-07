import type { AudioConnectables, ConnectableDescriptor } from 'src/patchNetwork/patchNetwork';
import { actionCreators, dispatch } from 'src/redux';

// The below functions are the main interface for interacting with/modifying the patch network.  They directly dispatch
// Redux actions which trigger conflict resolution, update the patch network state, perform actual connections/disconnections
// on audio nodes and params as needed, and trigger re-renders of the patch network UI.

export const connect = (from: ConnectableDescriptor, to: ConnectableDescriptor) =>
  dispatch(actionCreators.viewContextManager.CONNECT(from, to));

export const disconnect = (from: ConnectableDescriptor, to: ConnectableDescriptor) =>
  dispatch(actionCreators.viewContextManager.DISCONNECT(from, to));

export const removeNode = (vcId: string) =>
  dispatch(actionCreators.viewContextManager.REMOVE_PATCH_NETWORK_NODE(vcId));

export const updateConnectables = (vcId: string, newConnectables: AudioConnectables) => {
  if (!newConnectables) {
    console.trace(`Tried to update connectables for VC ${vcId} with nil connectables object`);
    return;
  }

  dispatch(actionCreators.viewContextManager.UPDATE_CONNECTABLES(vcId, newConnectables));
};
(window as any).updateConnectables = updateConnectables;
