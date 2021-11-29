/**
 * Defines an interactive graph editor that can be used to route connections between different
 * components of an audio composition.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LiteGraph } from 'litegraph.js';
import 'litegraph.js/css/litegraph.css';
import ControlPanel from 'react-control-panel';
import * as R from 'ramda';
import { useSelector } from 'react-redux';
import { filterNils } from 'ameo-utils';

import { registerAllCustomNodes } from './nodes';
import './GraphEditor.scss';
import { getState, ReduxStore } from 'src/redux';
import { updateGraph } from 'src/graphEditor/graphDiffing';
import { tryParseJson } from 'src/util';
import { LGAudioConnectables } from 'src/graphEditor/nodes/AudioConnectablesNode';
import { getEngine } from 'src/util';
import FlatButton from 'src/misc/FlatButton';
import { hide_graph_editor, setLGraphHandle } from 'src/graphEditor';
import { LiteGraph as LiteGraphInstance } from 'src/graphEditor/LiteGraphTypes';
import { ViewContextDescriptors } from 'src/ViewContextManager/AddModulePicker';

/**
 * Mapping of `stateKey`s to the graph instances that that they manage
 */
const GraphEditorInstances: Map<string, LiteGraphInstance> = new Map();
(window as any).GraphEditorInstances = GraphEditorInstances;
(window as any).LiteGraph = LiteGraph;

export const saveStateForInstance = (stateKey: string) => {
  const instance = GraphEditorInstances.get(stateKey);
  if (!instance) {
    console.error(`No entry in \`instanceCbs\` for instance with stateKey "${stateKey}"`);
    return;
  }

  const state = instance.serialize();
  const selectedNodes: { [key: string]: any } =
    instance.list_of_graphcanvas?.[0]?.selected_nodes ?? {};
  state.selectedNodeVcId = Object.values(selectedNodes)[0]?.connectables?.vcId;

  localStorage.setItem(stateKey, JSON.stringify(state));

  GraphEditorInstances.delete(stateKey);
};

const getLGNodeByVcId = (vcId: string) => {
  for (const instance of GraphEditorInstances.values()) {
    if (instance._nodes_by_id[vcId]) {
      return instance._nodes_by_id[vcId];
    }
  }
  return null;
};

const FlowingIntervalHandles = new Map<string, number>();
export const setConnectionFlowingStatus = (
  vcId: string,
  outputName: string,
  isFlowing: boolean
) => {
  if (!isFlowing) {
    const node = getLGNodeByVcId(vcId);
    const outputIx = node?.outputs?.findIndex(R.propEq('name', outputName)) ?? -1;
    if (!!node && outputIx !== -1) {
      node.clearTriggeredSlot(outputIx);
    }

    const intervalHandle = FlowingIntervalHandles.get(vcId);
    if (R.isNil(intervalHandle)) {
      return;
    }

    clearInterval(intervalHandle);
    FlowingIntervalHandles.delete(vcId);
    return;
  }

  const setFlowingCb = () => {
    const node = getLGNodeByVcId(vcId);

    const outputIx = node?.outputs?.findIndex(R.propEq('name', outputName)) ?? -1;

    if (node === null || outputIx === -1) {
      const intervalHandle = FlowingIntervalHandles.get(vcId);
      // Node or connection must have gone away
      if (!R.isNil(intervalHandle)) {
        clearInterval(intervalHandle);
        FlowingIntervalHandles.delete(vcId);
      }
      return;
    }

    node.triggerSlot(outputIx);
  };

  const intervalHandle = setInterval(setFlowingCb, 1000);
  FlowingIntervalHandles.set(vcId, intervalHandle);
  // Call once immediately
  setFlowingCb();
};

const handleNodeSelectAction = async ({
  smallViewDOMId,
  lgNode,
  setCurSelectedNode,
  setSelectedNodeVCID,
  isNowSelected,
  curSelectedNode,
}: {
  smallViewDOMId: string;
  lgNode: any;
  setCurSelectedNode: (newNode: any) => void;
  setSelectedNodeVCID: (id: string | null) => void;
  isNowSelected: boolean;
  curSelectedNode: any;
}) => {
  const nodeID: string = (lgNode as any).id.toString();
  if (lgNode instanceof LGAudioConnectables) {
    const node = getState().viewContextManager.activeViewContexts.find(vc => vc.uuid === nodeID);
    if (!node) {
      return;
    }

    (isNowSelected ? getEngine()!.render_small_view : getEngine()!.cleanup_small_view)(
      nodeID,
      smallViewDOMId
    );

    if (isNowSelected) {
      setCurSelectedNode(lgNode);
      setSelectedNodeVCID(nodeID);
    } else if (curSelectedNode === lgNode) {
      setCurSelectedNode(null);
      setSelectedNodeVCID(null);
    }
  } else if (lgNode.type.startsWith('customAudio')) {
    const functionKey = isNowSelected ? 'renderSmallView' : 'cleanupSmallView';
    if (!lgNode.connectables.node[functionKey]) {
      return;
    }

    await lgNode.connectables.node[functionKey](smallViewDOMId);

    if (isNowSelected) {
      setCurSelectedNode(lgNode);
      setSelectedNodeVCID(null);
    } else if (curSelectedNode === lgNode) {
      setCurSelectedNode(null);
    }
  }
};

const GraphControls: React.FC<{
  lGraphInstance: LiteGraphInstance | null;
}> = ({ lGraphInstance }) => {
  const selectedNodeType = useRef<string>('customAudio/LFO');

  const settings = useMemo(() => {
    const nodeEntries = Object.entries(LiteGraph.registered_node_types)
      .filter(([key]) => key.startsWith('customAudio/'))
      .map(([key, NodeClass]) => [NodeClass.typeName as string, key] as const);
    const vcEntries = ViewContextDescriptors.map(vc => [vc.displayName, vc.name] as const);
    const sortedNodeEntries = R.sortBy(
      ([name]) => name.toLowerCase(),
      [...nodeEntries, ...vcEntries]
    );

    return filterNils([
      lGraphInstance
        ? { type: 'button', label: 'arrange nodes', action: () => lGraphInstance.arrange() }
        : null,
      {
        type: 'select',
        label: 'node type',
        options: Object.fromEntries(sortedNodeEntries),
        initial: 'customAudio/LFO',
      },
      {
        type: 'button',
        label: 'add node',
        action: () => {
          const isVc = !selectedNodeType.current.startsWith('customAudio/');
          if (isVc) {
            const engine = getEngine();
            if (!engine) {
              return;
            }

            engine.create_view_context(selectedNodeType.current);
            return;
          }

          if (!lGraphInstance) {
            return;
          }
          const node = LiteGraph.createNode(selectedNodeType.current);
          lGraphInstance.add(node);
        },
      },
    ]);
  }, [lGraphInstance, selectedNodeType]);

  return (
    <ControlPanel
      style={{ width: 400 }}
      settings={settings}
      onChange={(key: string, val: any) => {
        switch (key) {
          case 'node type': {
            selectedNodeType.current = val;
            break;
          }
          default: {
            console.warn('Unhandled key in graph controls: ', key);
          }
        }
      }}
    />
  );
};

const GraphEditor: React.FC<{ stateKey: string }> = ({ stateKey }) => {
  const isInitialized = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [lGraphInstance, setLGraphInstance] = useState<LiteGraphInstance | null>(null);
  const [selectedNodeVCID, setSelectedNodeVCID] = useState<string | null>(null);
  const [curSelectedNode, setCurSelectedNode] = useState<any>(null);
  const { patchNetwork, activeViewContexts, isLoaded } = useSelector((state: ReduxStore) =>
    R.pick(['patchNetwork', 'activeViewContexts', 'isLoaded'], state.viewContextManager)
  );

  const vcId = stateKey.split('_')[1];
  const smallViewDOMId = `graph-editor_${vcId}_small-view-dom-id`;

  useEffect(() => {
    if (lGraphInstance) {
      setLGraphHandle(vcId, lGraphInstance);

      // If the graph editor isn't visible, make sure we stop its rendering to save resources
      const { activeViewContexts, activeViewContextIx } = getState().viewContextManager;
      const activeVC = activeViewContexts[activeViewContextIx];
      if (activeVC.uuid !== vcId) {
        hide_graph_editor(`graphEditor_${vcId}`);
      }

      return () => {
        setLGraphHandle(vcId, null);
      };
    } else {
      setLGraphHandle(vcId, null);
    }
  }, [lGraphInstance, vcId]);

  useEffect(() => {
    if (isInitialized.current || !canvasRef.current) {
      return;
    }
    isInitialized.current = true;

    (async () => {
      // Register custom node types
      await registerAllCustomNodes();

      const graph: LiteGraphInstance = new LiteGraph.LGraph();
      Object.keys((LiteGraph as any).registered_node_types)
        .filter(
          nodeType =>
            !nodeType.startsWith('customAudio') &&
            !nodeType.includes('faust') &&
            !nodeType.includes('audioConnectables')
        )
        .forEach(nodeType => (LiteGraph as any).unregisterNodeType(nodeType));
      const canvas = new LiteGraph.LGraphCanvas(`#${stateKey}_canvas`, graph);

      canvas.onNodeSelected = node => {
        if (curSelectedNode) {
          handleNodeSelectAction({
            smallViewDOMId,
            lgNode: curSelectedNode,
            setCurSelectedNode,
            setSelectedNodeVCID,
            isNowSelected: false,
            curSelectedNode,
          });
        }
        handleNodeSelectAction({
          smallViewDOMId,
          lgNode: node,
          setCurSelectedNode,
          setSelectedNodeVCID,
          isNowSelected: true,
          curSelectedNode,
        });
      };
      canvas.onNodeDeselected = node => {
        handleNodeSelectAction({
          smallViewDOMId,
          lgNode: node,
          setCurSelectedNode,
          setSelectedNodeVCID,
          isNowSelected: false,
          curSelectedNode,
        });
      };
      graph.onNodeRemoved = node => {
        handleNodeSelectAction({
          smallViewDOMId,
          lgNode: node,
          setCurSelectedNode,
          setSelectedNodeVCID,
          isNowSelected: false,
          curSelectedNode,
        });
      };

      graph.start();

      setLGraphInstance(graph);

      // Set an entry into the mapping so that we can get the current instance's state before unmounting
      GraphEditorInstances.set(stateKey, graph);
    })();
  });

  const lastPatchNetwork = useRef<typeof patchNetwork | null>(null);
  useEffect(() => {
    if (lastPatchNetwork.current === patchNetwork || !lGraphInstance) {
      return;
    }

    updateGraph(lGraphInstance, patchNetwork, activeViewContexts);
    lastPatchNetwork.current = patchNetwork;

    // If there is a currently selected node, it may have been de-selected as a result of being modified.  Try
    // to re-select it if it still exists.
    if (R.isNil(selectedNodeVCID)) {
      return;
    }

    const node = lGraphInstance._nodes.find(node => node.connectables?.vcId === selectedNodeVCID);
    if (!node) {
      setSelectedNodeVCID(null);
      return;
    }

    setCurSelectedNode(node);
    lGraphInstance.list_of_graphcanvas?.[0]?.selectNodes([node]);
    lGraphInstance.list_of_graphcanvas?.[0]?.onNodeSelected(node);
  }, [patchNetwork, lGraphInstance, activeViewContexts, selectedNodeVCID]);

  // Set node from serialized state when we first render
  useEffect(() => {
    if (!lGraphInstance || !isLoaded) {
      return;
    }
    const state =
      localStorage[stateKey] && localStorage[stateKey].length > 0
        ? tryParseJson<
            {
              nodes: { id: string | number; pos: [number, number] }[];
              selectedNodeVcId: string | null | undefined;
            },
            null
          >(localStorage[stateKey], null, 'Error parsing serialized LiteGraph state')
        : null;
    if (!state) {
      return;
    }

    if (state.selectedNodeVcId) {
      const node = lGraphInstance._nodes.find(
        node => node.connectables?.vcId === state.selectedNodeVcId
      );
      setCurSelectedNode(node);
      setSelectedNodeVCID(state.selectedNodeVcId);
      lGraphInstance.list_of_graphcanvas?.[0]?.selectNodes([node]);
      lGraphInstance.list_of_graphcanvas?.[0]?.onNodeSelected(node);
    }

    state.nodes.forEach(({ id, pos }) => {
      const node = lGraphInstance._nodes_by_id[id];
      if (!node) {
        return;
      }

      node.pos = pos;
    });
    lGraphInstance.setDirtyCanvas(true, true);
  }, [stateKey, lGraphInstance, isLoaded]);

  return (
    <>
      <div className='graph-editor-container' style={{ maxHeight: window.innerHeight - 130 }}>
        <canvas
          ref={ref => {
            canvasRef.current = ref;
          }}
          id={stateKey + '_canvas'}
          className='graph-editor'
          width={curSelectedNode ? window.innerWidth - 500 - 44 : window.innerWidth - 44}
          height={window.innerHeight - 130}
          style={{ maxHeight: window.innerHeight - 130 }}
        />

        <div style={{ display: 'flex', width: 400, flex: 1, flexDirection: 'column' }}>
          {selectedNodeVCID ? (
            <FlatButton
              style={{ marginBottom: 4 }}
              onClick={() => getEngine()!.switch_view_context(selectedNodeVCID)}
            >
              Show Full UI
            </FlatButton>
          ) : null}
          <div
            style={{
              display: 'flex',
              flex: 1,
              height: '100%',
              backgroundColor: '#111',
              width: curSelectedNode ? 500 : 0,
            }}
            id={smallViewDOMId}
          />
        </div>
      </div>
      <GraphControls lGraphInstance={lGraphInstance} />
    </>
  );
};

export default GraphEditor;
