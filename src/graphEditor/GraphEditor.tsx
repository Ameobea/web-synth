/**
 * Defines an interactive graph editor that can be used to route connections between different
 * components of an audio composition.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LiteGraph } from 'litegraph.js';
import 'litegraph.js/css/litegraph.css';
import ControlPanel, { Button } from 'react-control-panel';
import { Map, Set } from 'immutable';
import * as R from 'ramda';
import { Option } from 'funfix-core';

import { registerAllCustomNodes } from './nodes';
import './GraphEditor.scss';
import { ReduxStore } from 'src/redux';
import { connect } from 'react-redux';
import { PatchNetwork, AudioConnectables } from 'src/patchNetwork';
import { ArrayElementOf } from 'ameo-utils';

(window as any).LGraph = LiteGraph.LGraph;

/**
 * Mapping of `stateKey`s to the graph instances that that they manage
 */
const instaceMap: { [stateKey: string]: any } = {};

export const saveStateForInstance = (stateKey: string) => {
  const instance = instaceMap[stateKey];
  if (!instance) {
    console.error(`No entry in \`instanceCbs\` for instance with stateKey "${stateKey}"`);
    return;
  }

  const state = instance.serialize();
  localStorage.setItem(stateKey, JSON.stringify(state));

  delete instaceMap[stateKey];
};

interface LiteGraphNodePort {
  label: string;
  name: string;
  type: number;
}

interface LiteGraphNodeInput extends LiteGraphNodePort {
  link: number;
}

interface LiteGraphNodeOutput extends LiteGraphNodePort {
  links: number[];
}

interface LiteGraphNode {
  id: string;
  graph: LiteGraph;
  inputs: LiteGraphNodeInput[];
  outputs: LiteGraphNodeOutput[];
  getInputNode: (inputSlotIx: number) => LiteGraphNode | undefined;
  getOutputNodes: (outputSlotIx: number) => LiteGraphNode[];
  connect: (srcSlotIx: number, dstNode: LiteGraphNode, dstSlotIx: number) => void;
  disconnectOutput: (srcSlot: number | string, dstNode: LiteGraphNode) => boolean;
}

interface LiteGraphConnectablesNode extends LiteGraphNode {
  type: 'audio/audioConnectables';
  setConnectables: (connectables: AudioConnectables) => void;
  connectables: AudioConnectables;
}

interface LiteGraph {
  links: { origin_id: string; origin_slot: number; target_id: string; target_slot: number }[];
  _nodes: LiteGraphNode[];
  _nodes_by_id: { [id: string]: LiteGraphNode };
  createNode: (type: string, opts?: { [key: string]: any }) => LiteGraphNode;
  add: (node: LiteGraphNode) => void;
  remove: (node: LiteGraphNode) => void;
}

const EMPTY_PATCH_NETWORK: PatchNetwork = {
  connectables: Map(),
  connections: [],
};

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

const updateGraph = (graph: LiteGraph, patchNetwork: PatchNetwork) => {
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

const mapStateToProps = (state: ReduxStore) => ({
  patchNetwork: state.viewContextManager.patchNetwork,
});

const GraphEditor: React.FC<{ stateKey: string } & ReturnType<typeof mapStateToProps>> = ({
  stateKey,
  patchNetwork,
}) => {
  const isInitialized = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [lGraphInstance, setLGraphInstance] = useState<null | any>(null);

  useEffect(() => {
    if (isInitialized.current || !canvasRef.current) {
      return;
    }
    isInitialized.current = true;

    (async () => {
      // Register custom node types
      await registerAllCustomNodes();

      const graph = new LiteGraph.LGraph();
      console.log(graph);
      new LiteGraph.LGraphCanvas('#graph-editor', graph);

      const existingStateJson = localStorage.getItem(stateKey);
      if (existingStateJson) {
        const configureError = graph.configure(JSON.parse(existingStateJson));
        if (configureError) {
          console.error('Error while `.configure()`ing graph with stored JSON state');
        }
      } else {
        const node_const = LiteGraph.createNode('basic/const');
        node_const.id = 'test';
        node_const.pos = [200, 200];
        graph.add(node_const);
        node_const.setValue(4.5);

        const node_watch = LiteGraph.createNode('basic/watch');
        node_watch.id = 'test2';
        node_watch.pos = [700, 200];
        graph.add(node_watch);

        node_const.connect(0, node_watch, 0);
      }

      graph.start();

      setLGraphInstance(graph);

      // Set an entry into the mapping so that we can get the current instance's state before unmounting
      instaceMap[stateKey] = graph;
    })();
  });

  const lastPatchNetwork = useRef<typeof patchNetwork | null>(null);
  useEffect(() => {
    if (lastPatchNetwork.current === patchNetwork || !lGraphInstance) {
      return;
    }

    updateGraph(lGraphInstance, patchNetwork);
    lastPatchNetwork.current = patchNetwork;

    // Patch network changed, so we have to update our state to match it
    console.log('Patch network updated: ', patchNetwork);
  }, [patchNetwork, lGraphInstance]);

  const uiControls = useMemo(
    () =>
      lGraphInstance
        ? {
            arrange: () => lGraphInstance.arrange(),
            clear: () => lGraphInstance.clear(),
          }
        : {},
    [lGraphInstance]
  );

  return (
    <div className='graph-editor-container'>
      <canvas
        ref={ref => (canvasRef.current = ref)}
        id='graph-editor'
        width={800}
        height={600}
      ></canvas>

      <ControlPanel>
        <Button label='arrange' action={uiControls.arrange} />
        <Button label='clear' action={uiControls.clear} />
      </ControlPanel>
    </div>
  );
};

export default connect(mapStateToProps)(GraphEditor);
