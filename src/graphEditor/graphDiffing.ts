import { ArrayElementOf } from 'ameo-utils';
import * as R from 'ramda';
import { Map, Set } from 'immutable';
import { Option } from 'funfix-core';

import {
  LiteGraph,
  LiteGraphNode,
  LiteGraphConnectablesNode,
} from 'src/graphEditor/LiteGraphTypes';
import { AudioConnectables, PatchNetwork } from 'src/patchNetwork';

const createAudioConnectablesNode = (
  graph: LiteGraph,
  connectables: AudioConnectables,
  vcId: string
): LiteGraphNode => {
  const node = graph.createNode('audio/audioConnectables') as LiteGraphConnectablesNode;
  node.setConnectables(connectables);
  node.id = vcId;
  return node;
};

/**
 * Updates the provided `LiteGraph` `graph` to match the state of the provided `PatchNetwork` `patchNetwork`.  Nodes are
 * added/removed and connections connected/disconnected in order to bring them in sync.
 */
export const updateGraph = (graph: LiteGraph, patchNetwork: PatchNetwork) => {
  const { untouchedNodes, addedNodes, modifiedNodes } = [
    ...patchNetwork.connectables.entries(),
  ].reduce(
    (acc, [key, node]) => {
      const pairNode = graph._nodes_by_id[key];
      if (R.isNil(pairNode)) {
        return { ...acc, addedNodes: acc.addedNodes.add(key) };
      }

      if ((pairNode as LiteGraphConnectablesNode).connectables === node) {
        return { ...acc, untouchedNodes: acc.untouchedNodes.add(key) };
      }

      return { ...acc, modifiedNodes: acc.modifiedNodes.add(key) };
    },
    {
      untouchedNodes: Set() as Set<string>,
      addedNodes: Set() as Set<string>,
      modifiedNodes: Set() as Set<string>,
    }
  );

  // Any node present in the map that hasn't been accounted for already has been deleted
  const deletedNodes: Set<string> = Object.keys(graph._nodes_by_id).reduce(
    (acc, key) =>
      ![untouchedNodes, addedNodes, modifiedNodes].find(set => set.has(key)) ? acc.add(key) : acc,
    Set() as Set<string>
  );

  // Now, we just have to handle all of these computed diffs to synchronize the LiteGraph graph with the patch network

  // Create all new nodes, leaving them unconnected for now
  addedNodes.forEach(id => {
    const newNode = graph.createNode('audio/audioConnectables') as LiteGraphConnectablesNode;
    newNode.id = id;
    graph.add(newNode);
  });

  // Delete any removed nodes.  This automatically handles disconnecting them internally.
  deletedNodes.forEach(id => graph.remove(graph._nodes_by_id[id]));

  // Any connectables that are non-referentially-equal must be removed and re-created since we assume they have changed
  modifiedNodes.forEach(id => {
    const removedNode = graph._nodes_by_id[id] as LiteGraphConnectablesNode | undefined;
    if (!removedNode) {
      console.error(`Tried to replace audio node with id ${id} but it wasn't found somehow...`);
      return;
    }

    graph.remove(removedNode);
    const newNode = createAudioConnectablesNode(graph, removedNode.connectables, removedNode.id);
    newNode.id = id;
    graph.add(newNode);
  });

  // At this point, all nodes should be created/removed and have up-to-date `AudioConnectables`.  We must now run through the list
  // of connections and connect nodes in litegraph to reflect them
  //
  // We start by looping through the list of connections and checking if they all exist.  If they do not, we perform the connection now.
  //
  // Keep track of connections so that we can efficiently go back and check for missing connections later.
  type ConnectionsMap = Map<string, ArrayElementOf<(typeof patchNetwork)['connections']>[]>;
  const connectionsByNode: ConnectionsMap = patchNetwork.connections.reduce(
    (acc, connection) =>
      acc.set(connection[0].vcId, [...(acc.get(connection[0].vcId) || []), connection]),
    Map() as ConnectionsMap
  );

  const getNode = (id: string) => {
    const node = graph._nodes_by_id[id];
    if (!node) {
      console.error(
        `Connection referenced node id ${id} which doesn't exist in litegraph but should at this point`
      );
    } else {
      return node;
    }
  };

  // Prune existing connections that shouldn't be connected
  graph.links.forEach(({ origin_id, origin_slot, target_id, target_slot }) => {
    const linkExists = Option.of(connectionsByNode.get(origin_id))
      .flatMap(conns =>
        Option.of(
          !!conns.find(conn => {
            const srcNode = getNode(conn[0].vcId)!;
            return (
              conn[0].name === srcNode.outputs[origin_slot].name &&
              conn[1].vcId === target_id &&
              conn[1].name === getNode(conn[1].vcId)!.inputs[target_slot].name
            );
          })
        )
      )
      .getOrElse(false);

    if (!linkExists) {
      return;
    }

    // Disconnect the link
    const srcNode = getNode(origin_id)!;
    const dstNode = getNode(target_id)!;

    const disconnectionSuccessful = srcNode.disconnectOutput(origin_slot, dstNode);
    if (!disconnectionSuccessful) {
      console.error('Failed to prune connection between nodes:', {
        origin_id,
        origin_slot,
        target_id,
        target_slot,
      });
    }
  });

  patchNetwork.connections.forEach(
    connection => {
      // Check to see if we have an actual existing connection between the two nodes/ports and create one if we don't

      const srcNode = getNode(connection[0].vcId);
      if (!srcNode) {
        return;
      }
      const srcSlotIx = srcNode.outputs.findIndex(R.propEq('name', connection[0].name));
      if (srcSlotIx === -1) {
        console.error(
          `Expected to find output with name ${connection[0].name} on node id ${connection[0].vcId} but it wasn't found`
        );
        return;
      }

      const dstNode = getNode(connection[1].vcId);
      if (!dstNode) {
        return;
      }
      const dstSlotIx = dstNode.inputs.findIndex(R.propEq('name', connection[1].name));
      if (dstSlotIx === -1) {
        console.error(
          `Expected to find output with name ${connection[1].name} on node id ${connection[1].vcId} but it wasn't found`
        );
        return;
      }

      // Time complexity is sub-optimal here but should be ok
      const connectionExists = graph.links
        .filter(R.identity)
        .find(
          ({ origin_id, origin_slot, target_id, target_slot }) =>
            origin_id === connection[0].vcId &&
            origin_slot === srcSlotIx &&
            target_id === connection[1].vcId &&
            target_slot === dstSlotIx
        );

      if (!connectionExists) {
        srcNode.connect(srcSlotIx, dstNode, dstSlotIx);
      }
    },
    Map() as ConnectionsMap
  );
};
