import { Map } from 'immutable';
import { Option } from 'funfix-core';

import { VCMState, getConnectedPair } from 'src/redux/modules/viewContextManager';
import { getEngine } from 'src';
import { actionCreators, dispatch } from 'src/redux';
import {
  audioNodeGetters,
  buildConnectablesForNode,
  ForeignNode,
} from 'src/graphEditor/nodes/CustomAudio';

export interface MIDINode {
  connect: (dst: MIDINode) => void;
  disconnect: (dst?: MIDINode) => void;
  /**
   * Returns a function that, when called, triggers an input on this MIDI node.  Must return the exact same object
   * each time it's called.
   */
  getInputCbs: () => {
    onAttack: (note: number, voiceIx: number, velocity: number) => void;
    onRelease: (note: number, voiceIx: number, velocity: number) => void;
    onPitchBend: (bendAmount: number) => void;
  };
}

export interface AudioConnectables {
  vcId: string;
  inputs: Map<string, { node: AudioParam | AudioNode | MIDINode; type: string }>;
  outputs: Map<string, { node: AudioNode | MIDINode; type: string }>;
  /**
   * This is used by custom audio nodes to re-use foreign audio nodes when re-initializing/updating the patch network.  Without this,
   * we'd have to re-create the connectables from scratch using a new audio node, which would require creating a new audio node,
   * disconnecting the old one, connecting the new one, which is inefficient.
   */
  node?: ForeignNode;
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

export const addNode = (vcId: string, connectables: AudioConnectables) =>
  dispatch(actionCreators.viewContextManager.ADD_PATCH_NETWORK_NODE(vcId, connectables));

export const removeNode = (vcId: string) =>
  dispatch(actionCreators.viewContextManager.REMOVE_PATCH_NETWORK_NODE(vcId));

export const updateConnectables = (vcId: string, newConnectables: AudioConnectables) => {
  if (!newConnectables) {
    console.trace(`Tried to update connectables for VC ${vcId} with nil connectables object`);
    return;
  }

  dispatch(actionCreators.viewContextManager.UPDATE_CONNECTABLES(vcId, newConnectables));
};

/**
 * Clear the state of the patch network, re-initializing it from scratch given the provided set of view contexts and
 * connections between them.
 */
export const initPatchNetwork = (
  oldPatchNetwork: PatchNetwork,
  viewContexts: VCMState['activeViewContexts'],
  foreignConnectables: {
    type: string;
    id: string;
    serializedState?: { [key: string]: any } | null;
  }[],
  connections: VCMState['patchNetwork']['connections']
): PatchNetwork => {
  const engine = getEngine();
  if (!engine) {
    throw new Error('Tried to init patch network before engine handle was set');
  }

  // Create connectables for all nodes
  let newConnectablesMap = viewContexts.reduce((newConnectablesMap, { uuid }) => {
    // TODO: Deal with default connections?
    const connectables = engine.get_vc_connectables(uuid);
    return connectables ? newConnectablesMap.set(uuid, connectables) : newConnectablesMap;
  }, Map<string, AudioConnectables>());

  // Create connectables for foreign nodes
  newConnectablesMap = foreignConnectables.reduce(
    (newConnectablesMap, { type, id, serializedState }) => {
      // Re-use the `AudioNode` from the old connectables if possible, falling back to creating a fresh one
      const node: ForeignNode = Option.of(oldPatchNetwork.connectables.get(id))
        .flatMap(({ node }) => Option.of(node))
        .getOrElseL(() => audioNodeGetters[type]!.nodeGetter(id, serializedState));

      return newConnectablesMap.set(id, buildConnectablesForNode(node, id));
    },
    newConnectablesMap
  );

  const newConnections = oldPatchNetwork.connections.filter(([from, to]) => {
    const fromConnectables = oldPatchNetwork.connectables.get(from.vcId);
    const toConnectables = oldPatchNetwork.connectables.get(to.vcId);

    if (!fromConnectables && !toConnectables) {
      return true;
    }

    const fromConnectablesReal: AudioConnectables = (fromConnectables ||
      newConnectablesMap.get(from.vcId))!;
    const toConnectablesReal: AudioConnectables = (toConnectables ||
      newConnectablesMap.get(to.vcId))!;

    if (!fromConnectablesReal || !toConnectablesReal) {
      return false;
    }

    const src = fromConnectablesReal.outputs.get(from.name)!;
    const dst = toConnectablesReal.inputs.get(to.name)!;

    (src.node as any).disconnect(dst.node);

    return false;
  });

  // Perform new connections
  const addedConnections = connections.filter(([from, to]) => {
    const connectedPair = getConnectedPair(newConnectablesMap, from, to);
    if (!connectedPair) {
      return false;
    }

    // Do nothing if this is already connected by the existing set of connections
    if (
      newConnections.find(
        ([otherFrom, otherTo]) =>
          otherFrom.name === from.name &&
          otherFrom.vcId === from.vcId &&
          otherTo.name === to.name &&
          otherTo.vcId === to.vcId
      )
    ) {
      return false;
    }

    if (connectedPair[0].type !== connectedPair[1].type) {
      console.error(
        'Invalid connection found when initializing patch network; mis-matched types: ',
        { ...connectedPair[0], name: from.name, vcId: from.vcId },
        { ...connectedPair[1], name: to.name, vcId: to.vcId }
      );
      return false;
    }

    // Perform the connection
    (connectedPair[0].node as any).connect(connectedPair[1].node);
    return true;
  });

  // Disconnect any connections between nodes that have been removed
  return {
    connectables: newConnectablesMap,
    connections: [...newConnections, ...addedConnections],
  };
};

export const create_empty_audio_connectables = (vcId: string): AudioConnectables => ({
  vcId,
  inputs: Map(),
  outputs: Map(),
});
