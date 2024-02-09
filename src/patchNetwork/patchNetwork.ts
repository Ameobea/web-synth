import { Option } from 'funfix-core';
import { Map } from 'immutable';

import { PlaceholderOutput } from 'src/controlPanel/PlaceholderOutput';
import { audioNodeGetters, type ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { connectNodes, disconnectNodes, getConnectedPair } from 'src/redux/modules/vcmUtils';
import type { VCMState } from 'src/redux/modules/viewContextManager';
import { getEngine } from 'src/util';
import type { MIDINode } from './midiNode';

export type ConnectableType = 'midi' | 'number' | 'customAudio' | 'any';

export const formatConnectableType = (type: ConnectableType): string => {
  switch (type) {
    case 'midi':
      return 'MIDI';
    case 'number':
      return 'CV';
    case 'customAudio':
      return 'Audio';
    case 'any':
      return 'Any';
    default:
      console.error('Invalid connectable type: ', type);
      return 'Unknown';
  }
};

export interface ConnectableInput {
  node: AudioParam | AudioNode | MIDINode;
  type: ConnectableType;
}
export interface ConnectableOutput {
  node: AudioNode | MIDINode;
  type: ConnectableType;
}

export interface AudioConnectables {
  vcId: string;
  inputs: Map<string, ConnectableInput>;
  outputs: Map<string, ConnectableOutput>;
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

export interface SubgraphDescriptor {
  id: string;
  name: string;
  activeVcId: string;
}

export interface ForeignConnectable {
  type: string;
  id: string;
  serializedState: any;
  subgraphId: string;
}

export interface PatchNetwork {
  connectables: Map<string, AudioConnectables>;
  connections: [ConnectableDescriptor, ConnectableDescriptor][];
}

/**
 * Clear the state of the patch network, re-initializing it from scratch given the provided set of view contexts and
 * connections between them.
 */
export const initPatchNetwork = (
  oldPatchNetwork: PatchNetwork,
  viewContexts: VCMState['activeViewContexts'],
  foreignConnectables: ForeignConnectable[],
  connections: VCMState['patchNetwork']['connections'],
  ctx: AudioContext
): PatchNetwork => {
  const engine = getEngine();
  if (!engine) {
    throw new Error('Tried to init patch network before engine handle was set');
  }

  // Create connectables for all nodes
  let newConnectablesMap = viewContexts.reduce((newConnectablesMap, { uuid }) => {
    const connectables = engine.get_vc_connectables(uuid);
    return connectables ? newConnectablesMap.set(uuid, connectables) : newConnectablesMap;
  }, Map<string, AudioConnectables>());

  // Create connectables for foreign nodes
  newConnectablesMap = foreignConnectables.reduce(
    (newConnectablesMap, { type, id, serializedState }) => {
      // Re-use the `AudioNode` from the old connectables if possible, falling back to creating a fresh one
      const node: ForeignNode = Option.of(oldPatchNetwork.connectables.get(id))
        .flatMap(({ node }) => Option.of(node))
        .getOrElseL(() => new audioNodeGetters[type]!.nodeGetter(ctx, id, serializedState));

      return newConnectablesMap.set(id, { ...node.buildConnectables(), vcId: id });
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

    disconnectNodes(src.node, dst.node, to);

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

    if (
      connectedPair[0].type !== connectedPair[1].type &&
      connectedPair[0].type !== 'any' &&
      connectedPair[1].type !== 'any'
    ) {
      console.error(
        'Invalid connection found when initializing patch network; mis-matched types: ',
        { ...connectedPair[0], name: from.name, vcId: from.vcId },
        { ...connectedPair[1], name: to.name, vcId: to.vcId }
      );
      return false;
    }

    // Perform the connection
    try {
      (connectedPair[0].node as any).connect(
        connectedPair[1].node,
        connectedPair[0].node instanceof PlaceholderOutput ? to : undefined
      );
      connectNodes(connectedPair[0].node, connectedPair[1].node, from, to);
    } catch (err) {
      console.error('Error connecting nodes: ', err);
      console.error({ connectedPair, from, to });
    }
    return true;
  });

  // Disconnect any connections between nodes that have been removed
  return {
    connectables: newConnectablesMap,
    connections: [...newConnections, ...addedConnections],
  };
};
