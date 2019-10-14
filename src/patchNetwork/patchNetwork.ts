import { VCMState } from 'src/redux/modules/viewContextManager';

export interface AudioConnectables {
  vcId: string;
  params: AudioParamMap;
  nodes: Map<string, AudioNode>;
}

export interface ConnectableDescriptor {
  vcId: string;
  name: string;
}

interface PatchNetwork {
  connectables: Map<string, AudioConnectables>;
  paramConnections: [ConnectableDescriptor, ConnectableDescriptor][];
  nodeConnections: [ConnectableDescriptor, ConnectableDescriptor][];
}

const GLOBAL_PATCH_NETWORK: PatchNetwork = {
  connectables: new Map(),
  paramConnections: [],
  nodeConnections: [],
};

export const connectParam = (from: ConnectableDescriptor, to: ConnectableDescriptor) => {};

export const connectNode = (from: ConnectableDescriptor, to: ConnectableDescriptor) => {};

/**
 * Clear the state of the patch network, re-initializing it from scratch given the provided set of view contexts and
 * connections between them.
 */
export const initPatchNetwork = (viewContexts: VCMState['activeViewContexts']) => {
  const oldConnectables = GLOBAL_PATCH_NETWORK.connectables;
  GLOBAL_PATCH_NETWORK.connectables = new Map();

  // Diff the set of old VCs and new VCs to find which have been added and which have been removed
  const addedVCIds = new Set();
  const removedVCIds = new Set();
  viewContexts.forEach(({ id }) => {
    const old = oldConnectables.get(id);
    if (old) {
      GLOBAL_PATCH_NETWORK.connectables.set(id, old);
      oldConnectables.delete(id);
    } else {
      // TODO
    }
  });
};
