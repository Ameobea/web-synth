/**
 * Defines an interactive graph editor that can be used to route connections between different
 * components of an audio composition.
 */
import { filterNils, UnreachableException } from 'ameo-utils';
import { LGraph, LGraphCanvas, LGraphNode, LiteGraph } from 'litegraph.js';

import 'litegraph.js/css/litegraph.css';
import * as R from 'ramda';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { useSelector } from 'react-redux';

import './GraphEditor.scss';
import { hide_graph_editor, setLGraphHandle } from 'src/graphEditor';
import { updateGraph } from 'src/graphEditor/graphDiffing';
import { LGAudioConnectables } from 'src/graphEditor/nodes/AudioConnectablesNode';
import FlatButton from 'src/misc/FlatButton';
import { getState, type ReduxStore } from 'src/redux';
import { getEngine, tryParseJson } from 'src/util';
import { ViewContextDescriptors } from 'src/ViewContextManager/AddModulePicker';
import {
  getIsVcHidden,
  registerVcHideCb,
  unregisterVcHideCb,
} from 'src/ViewContextManager/VcHideStatusRegistry';
import { registerAllCustomNodes } from './nodes';

LGraphCanvas.prototype.getCanvasMenuOptions = () => [];
const oldGetNodeMenuOptions = LGraphCanvas.prototype.getNodeMenuOptions;
LGraphCanvas.prototype.getNodeMenuOptions = function (node: LGraphNode) {
  const options = oldGetNodeMenuOptions.apply(this, [node]);
  const OptionsToRemove = [
    'Title',
    'Clone',
    'Inputs',
    'Outputs',
    'Properties',
    'Mode',
    'Pin',
    'Resize',
  ];
  const filteredOptions = options.filter(item => {
    if (!item) {
      return true;
    }
    if (OptionsToRemove.includes(item.content)) {
      return false;
    }

    return true;
  });

  while (filteredOptions[0] === null) {
    filteredOptions.splice(0, 1);
  }

  // Remove duplicate subsequent nulls which map to dividers in the menu
  return filteredOptions.filter((opt, i) => {
    if (i > 0 && opt === null && filteredOptions[i - 1] === null) {
      return false;
    }
    return true;
  });
};
LGraphCanvas.prototype.showLinkMenu = function (link: any, e) {
  const options = ['Delete'];

  const innerClicked = (label: any, _options: unknown, _e: unknown) => {
    switch (label) {
      case 'Delete':
        this.graph.removeLink(link.id);
        break;
      case null:
        break;
      default:
        throw new UnreachableException(`Unknown menu option: ${label}`);
    }
  };

  new LiteGraph.ContextMenu(options as any, {
    event: e,
    title: link.data != null ? link.data.constructor.name : null,
    callback: innerClicked,
  });

  return false;
};
LGraphCanvas.prototype.processNodeDblClicked = (node: LGraphNode) => {
  const nodeID = node.id as string | number;
  if (nodeID && typeof nodeID === 'string' && nodeID.length === 36) {
    getEngine()!.switch_view_context(nodeID);
  }
};

/**
 * Mapping of `stateKey`s to the graph instances that that they manage
 */
const GraphEditorInstances: Map<string, LGraph> = new Map();
(window as any).GraphEditorInstances = GraphEditorInstances;
(window as any).LiteGraph = LiteGraph;

export const saveStateForInstance = (stateKey: string) => {
  const instance = GraphEditorInstances.get(stateKey);
  if (!instance) {
    console.error(`No entry in \`GraphEditorInstances\` for instance with stateKey "${stateKey}"`);
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

interface HandleNodeSelectActionArgs {
  smallViewDOMId: string;
  lgNode: any;
  setCurSelectedNode: (newNode: any) => void;
  setSelectedNodeVCID: (id: string | null) => void;
  isNowSelected: boolean;
  curSelectedNodeRef: React.MutableRefObject<any>;
}

const handleNodeSelectAction = async ({
  smallViewDOMId,
  lgNode,
  setCurSelectedNode,
  setSelectedNodeVCID,
  isNowSelected,
  curSelectedNodeRef,
}: HandleNodeSelectActionArgs) => {
  if (!lgNode?.id) {
    return;
  }

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
    } else if (curSelectedNodeRef.current === lgNode) {
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
    } else if (curSelectedNodeRef.current === lgNode) {
      setCurSelectedNode(null);
    }
  }
};

interface GraphControlsProps {
  lGraphInstance: LGraph | null;
}

const GraphControls: React.FC<GraphControlsProps> = ({ lGraphInstance }) => {
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
  const lGraphCanvasRef = useRef<LGraphCanvas | null>(null);
  const [lGraphInstance, setLGraphInstance] = useState<LGraph | null>(null);
  const [selectedNodeVCID, setSelectedNodeVCID] = useState<string | null>(null);
  const [curSelectedNode, setCurSelectedNodeInner] = useState<any>(null);
  const curSelectedNodeRef = useRef<any>(null);
  const setCurSelectedNode = useCallback(
    (newNode: any) => {
      curSelectedNodeRef.current = newNode;
      setCurSelectedNodeInner(newNode);
    },
    [setCurSelectedNodeInner]
  );
  const { patchNetwork, activeViewContexts, isLoaded } = useSelector((state: ReduxStore) =>
    R.pick(['patchNetwork', 'activeViewContexts', 'isLoaded'], state.viewContextManager)
  );

  const [canvasHeight, setCanvasHeight] = useState(window.innerHeight - 130);
  useEffect(() => {
    const onResize = () => {
      const newHeight = window.innerHeight - 130;
      setCanvasHeight(newHeight);
      const newWidth = curSelectedNodeRef.current
        ? window.innerWidth - 500 - 44
        : window.innerWidth - 44;
      lGraphCanvasRef.current?.resize(newWidth, newHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const vcId = stateKey.split('_')[1];
  const smallViewDOMId = `graph-editor_${vcId}_small-view-dom-id`;

  useEffect(() => {
    if (!lGraphInstance) {
      return;
    }

    const cb = (isHidden: boolean) => {
      if (isHidden) {
        lGraphInstance.stop();
      } else {
        lGraphInstance.start();
      }
    };

    registerVcHideCb(vcId, cb);
    return () => unregisterVcHideCb(vcId, cb);
  }, [vcId, lGraphInstance]);

  useEffect(() => {
    if (lGraphInstance) {
      setLGraphHandle(vcId, lGraphInstance);

      // If the graph editor isn't visible, make sure we stop its rendering to save resources
      const { activeViewContexts, activeViewContextIx } = getState().viewContextManager;
      const activeVC = activeViewContexts[activeViewContextIx];
      if (!activeVC) {
        console.error('No active view context');
        return;
      }

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

      const graph = new LGraph();
      Object.keys(LiteGraph.registered_node_types)
        .filter(
          nodeType =>
            !nodeType.startsWith('customAudio') &&
            !nodeType.includes('faust') &&
            !nodeType.includes('audioConnectables')
        )
        .forEach(nodeType => (LiteGraph as any).unregisterNodeType(nodeType));
      Object.keys(LiteGraph.searchbox_extras).forEach(
        key => delete LiteGraph.searchbox_extras[key]
      );
      const canvas = new LGraphCanvas(`#${stateKey}_canvas`, graph);
      lGraphCanvasRef.current = canvas;

      canvas.onNodeSelected = node => {
        if (curSelectedNodeRef.current) {
          handleNodeSelectAction({
            smallViewDOMId,
            lgNode: curSelectedNode,
            setCurSelectedNode,
            setSelectedNodeVCID,
            isNowSelected: false,
            curSelectedNodeRef,
          });
        }
        handleNodeSelectAction({
          smallViewDOMId,
          lgNode: node,
          setCurSelectedNode,
          setSelectedNodeVCID,
          isNowSelected: true,
          curSelectedNodeRef,
        });
      };
      canvas.onNodeDeselected = node => {
        handleNodeSelectAction({
          smallViewDOMId,
          lgNode: node,
          setCurSelectedNode,
          setSelectedNodeVCID,
          isNowSelected: false,
          curSelectedNodeRef,
        });
      };
      graph.onNodeRemoved = node => {
        handleNodeSelectAction({
          smallViewDOMId,
          lgNode: node,
          setCurSelectedNode,
          setSelectedNodeVCID,
          isNowSelected: false,
          curSelectedNodeRef,
        });
      };

      const isHidden = getIsVcHidden(vcId);

      if (!isHidden) {
        graph.start();
      } else {
        graph.stop();
      }

      setLGraphInstance(graph);

      // Set an entry into the mapping so that we can get the current instance's state before unmounting
      GraphEditorInstances.set(stateKey, graph);
    })();
  }, [curSelectedNode, setCurSelectedNode, smallViewDOMId, stateKey, vcId]);

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
    lGraphInstance.list_of_graphcanvas?.[0]?.onNodeSelected?.(node);
  }, [patchNetwork, lGraphInstance, activeViewContexts, selectedNodeVCID, setCurSelectedNode]);

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
  }, [stateKey, lGraphInstance, isLoaded, setCurSelectedNode]);

  return (
    <>
      <div className='graph-editor-container' style={{ maxHeight: canvasHeight }}>
        <canvas
          ref={canvasRef}
          id={stateKey + '_canvas'}
          className='graph-editor'
          width={curSelectedNode ? window.innerWidth - 500 - 44 : window.innerWidth - 44}
          height={canvasHeight}
          style={{ maxHeight: canvasHeight }}
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
