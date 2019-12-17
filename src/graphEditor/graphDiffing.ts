import { ArrayElementOf } from 'ameo-utils';
import * as R from 'ramda';
import { Map, Set } from 'immutable';
import { Option } from 'funfix-core';
import { LiteGraph } from 'litegraph.js';

import {
  LiteGraph as LiteGraphInstance,
  LiteGraphNode,
  LiteGraphConnectablesNode,
} from 'src/graphEditor/LiteGraphTypes';
import { AudioConnectables, PatchNetwork } from 'src/patchNetwork';
import { ReduxStore } from 'src/redux';

const createAudioConnectablesNode = (
  connectables: AudioConnectables,
  vcId: string,
  title: string,
  typeOverride?: string | null | undefined
): LiteGraphNode => {
  const node = LiteGraph.createNode(
    typeOverride || 'audio/audioConnectables',
    title,
    {}
  ) as LiteGraphConnectablesNode;
  node.id = vcId.toString();
  node.setConnectables(connectables);
  return node;
};

const getVcTitle = (
  activeViewContexts: ReduxStore['viewContextManager']['activeViewContexts'],
  id: string
): string =>
  Option.of(activeViewContexts.find(R.propEq('uuid', id)))
    .flatMap(({ title, name }) => Option.of(title).orElse(Option.of(name)))
    .getOrElseL(() => {
      console.warn(`Unable to find view context with id "${id}"`);
      return 'Untitled';
    });

/**
 * Updates the provided `LiteGraph` `graph` to match the state of the provided `PatchNetwork` `patchNetwork`.  Nodes are
 * added/removed and connections connected/disconnected in order to bring them in sync.
 */
export const updateGraph = (
  graph: LiteGraphInstance,
  patchNetwork: PatchNetwork,
  activeViewContexts: ReduxStore['viewContextManager']['activeViewContexts']
) => {
  const { modifiedNodes, unchangedNodes, addedNodes } = [
    ...patchNetwork.connectables.entries(),
  ].reduce(
    (acc, [key, connectables]) => {
      const pairNode = graph._nodes_by_id[key];

      if (R.isNil(pairNode)) {
        return { ...acc, addedNodes: acc.addedNodes.add(key) };
      } else if (connectables !== pairNode.connectables) {
        return { ...acc, modifiedNodes: acc.modifiedNodes.add(key) };
      }

      return { ...acc, unchangedNodes: acc.unchangedNodes.add(key) };
    },
    { modifiedNodes: Set<string>(), unchangedNodes: Set<string>(), addedNodes: Set<string>() }
  );

  // Any node present in the map that hasn't been accounted for already has been deleted
  const deletedNodes: Set<string> = Object.keys(graph._nodes_by_id).reduce(
    (acc, key) =>
      ![modifiedNodes, unchangedNodes, addedNodes].find(set => set.has(key)) ? acc.add(key) : acc,
    Set() as Set<string>
  );

  // Now, we just have to handle all of these computed diffs to synchronize the LiteGraph graph with the patch network

  const createAndAddNode = (id: string, params?: { [key: string]: any }) => {
    // Time complexity sucks here
    const connectables = patchNetwork.connectables.get(id)!;
    const foreignAudioNode = patchNetwork.connectables.get(id)!.node;
    const newNode = createAudioConnectablesNode(
      connectables,
      id,
      foreignAudioNode ? foreignAudioNode.name : getVcTitle(activeViewContexts, id),
      foreignAudioNode ? foreignAudioNode.nodeType : null
    );

    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        (newNode as any)[key] = val;
      });
    }

    graph.add(newNode);
  };

  // Create all new nodes, leaving them unconnected for now
  addedNodes.forEach(id => createAndAddNode(id));

  // Delete any removed nodes.  This automatically handles disconnecting them internally.
  deletedNodes.forEach(id => graph.remove(graph._nodes_by_id[id]));

  // Delete and re-create any modified nodes.  Connections will be resolved later.
  modifiedNodes.forEach(key => {
    const node = graph._nodes_by_id[key];
    if (!node) {
      throw new Error("Tried to remove a node that didn't exist");
    }
    const { pos } = node;

    // Don't trigger patch network actions since these changes are purely presentational
    node.ignoreRemove = true;
    graph.remove(node);
    createAndAddNode(key, { ignoreAdd: true, pos });
  });

  // At this point, all nodes should be created/removed and have up-to-date `AudioConnectables`.  We must now run through the list
  // of connections and connect nodes in litegraph to reflect them
  //
  // We start by looping through the list of connections and checking if they all exist.  If they do not, we perform the connection now.
  //
  // Keep track of connections so that we can efficiently go back and check for missing connections later.
  type ConnectionsMap = Map<string, ArrayElementOf<typeof patchNetwork['connections']>[]>;
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
  Object.values(graph.links).forEach(({ origin_id, origin_slot, target_id, target_slot }) => {
    const linkExists = Option.of(connectionsByNode.get(origin_id.toString()))
      .flatMap(conns =>
        Option.of(
          !!conns.find(conn => {
            const srcNode = getNode(conn[0].vcId)!;
            return (
              conn[0].name === srcNode.outputs[origin_slot].name &&
              conn[1].vcId === target_id.toString() &&
              conn[1].name === getNode(conn[1].vcId)!.inputs[target_slot].name
            );
          })
        )
      )
      .getOrElse(false);

    if (linkExists) {
      return;
    }

    // Disconnect the link
    const srcNode = getNode(origin_id.toString())!;
    const dstNode = getNode(target_id.toString())!;

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

  patchNetwork.connections.forEach(connection => {
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
    const connectionExists = Object.values(graph.links)
      .filter(R.identity)
      .find(
        ({ origin_id, origin_slot, target_id, target_slot }) =>
          origin_id.toString() === connection[0].vcId &&
          origin_slot === srcSlotIx &&
          target_id.toString() === connection[1].vcId &&
          target_slot === dstSlotIx
      );

    if (!connectionExists) {
      srcNode.connect(srcSlotIx, dstNode, dstSlotIx);
    }
  }, Map() as ConnectionsMap);
};
