import { VCMState } from 'src/redux/modules/viewContextManager';
import { getEngine } from 'src';

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

export const connectParam = (from: ConnectableDescriptor, to: ConnectableDescriptor) => {};

export const connectNode = (from: ConnectableDescriptor, to: ConnectableDescriptor) => {};

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
