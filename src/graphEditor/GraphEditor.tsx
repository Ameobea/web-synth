/**
 * Defines an interactive graph editor that can be used to route connections between different
 * components of an audio composition.
 */

import { type ContextMenu, LGraph, LGraphCanvas, LiteGraph, type LGraphNode } from 'litegraph.js';

import type {
  LiteGraphConnectablesNode,
  LiteGraph as LiteGraphInstance,
} from 'src/graphEditor/LiteGraphTypes';
import 'litegraph.js/css/litegraph.css';
import * as R from 'ramda';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { shallowEqual, useSelector } from 'react-redux';

import './GraphEditor.css';
import { hide_graph_editor, setLGraphHandle } from 'src/graphEditor';
import { InitialPosByVcID, updateGraph } from 'src/graphEditor/graphDiffing';
import { LGAudioConnectables } from 'src/graphEditor/nodes/AudioConnectablesNode';
import FlatButton from 'src/misc/FlatButton';
import { actionCreators, dispatch, getState, type ReduxStore } from 'src/redux';
import {
  NIL_UUID,
  UnreachableError,
  filterNils,
  getEngine,
  tryParseJson,
  unescapeHTML,
} from 'src/util';
import { ViewContextDescriptors } from 'src/ViewContextManager/AddModulePicker';
import {
  getIsVcHidden,
  registerVcHideCb,
  unregisterVcHideCb,
} from 'src/ViewContextManager/VcHideStatusRegistry';
import { registerAllCustomNodes } from './nodes';
import type { AudioConnectables, ViewContextDefinition } from 'src/patchNetwork';
import {
  audioNodeGetters,
  buildNewForeignConnectableID,
  type ForeignNode,
} from 'src/graphEditor/nodes/CustomAudio';
import { connect, removeNode } from 'src/patchNetwork/interface';
import { SubgraphPortalNode } from 'src/graphEditor/nodes/CustomAudio/Subgraph/SubgraphPortalNode';
import { renderModalWithControls, renderSvelteModalWithControls } from 'src/controls/Modal';
import ConfirmReset from 'src/sampler/SamplerUI/ConfirmReset.svelte';
import type { SveltePropTypesOf } from 'src/svelteUtils';
import { persistAllVCsAndFCs } from 'src/persistance';
import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import {
  fetchSubgraphPresets,
  getExistingSubgraphPresetTags,
  getSubgraphPreset,
  saveSubgraphPreset as saveSubgraphPresetAPI,
} from 'src/api';
import { getSentry, logError } from 'src/sentry';
import {
  mkGenericPresetPicker,
  type PresetDescriptor,
} from 'src/controls/GenericPresetPicker/GenericPresetPicker';
import { handleGlobalMouseDown } from 'src/globalInputHandlers';

const ctx = new AudioContext();

const confirmAndDeleteSubgraph = async (subgraphID: string) => {
  const subgraphName = getState().viewContextManager.subgraphsByID[subgraphID]?.name ?? 'Unknown';
  const isEmpty =
    getState().viewContextManager.activeViewContexts.every(
      vc => vc.name === 'graph_editor' || vc.subgraphId !== subgraphID
    ) &&
    getState().viewContextManager.foreignConnectables.every(
      fc => fc.type === 'customAudio/subgraphPortal' || fc.subgraphId !== subgraphID
    );

  if (!isEmpty) {
    try {
      await renderSvelteModalWithControls<void, SveltePropTypesOf<typeof ConfirmReset>>(
        ConfirmReset,
        true,
        {
          message: `Are you sure you want to delete the subgraph "${subgraphName}"?`,
          cancelMessage: 'Cancel',
          resetMessage: 'Delete',
        }
      );
    } catch (_err) {
      return; // cancelled
    }
  }

  getEngine()!.delete_subgraph(subgraphID);
};

/**
 * If `overrideName` is set to `true`, then the name of the created base subgraph will be set to
 * the name of the preset.
 */
export const saveSubgraphPreset = async (subgraphID: string, overrideName = false) => {
  let desc;
  try {
    desc = await renderGenericPresetSaverWithModal({
      description: true,
      getExistingTags: getExistingSubgraphPresetTags,
      title: 'Save Subgraph',
    });
  } catch (_err) {
    return; // cancelled
  }

  // Commit all state to the engine
  persistAllVCsAndFCs();
  const serializedSubgraph = getEngine()!.serialize_subgraph(
    subgraphID,
    overrideName ? desc.name : ''
  );

  try {
    await saveSubgraphPresetAPI({
      description: desc.description ?? '',
      name: desc.name,
      preset: JSON.parse(serializedSubgraph),
      tags: desc.tags ?? [],
    });
    toastSuccess('Subgraph preset saved');
  } catch (err) {
    logError('Error saving subgraph preset', err);
    toastError('Error saving subgraph preset: ' + `${err}`);
  }
};

const duplicateNode = (node: LGraphNode, pos?: { x: number; y: number }) => {
  const vcId = node.id.toString();
  const isVc = vcId.length === 36;

  let createdVcId: string;
  if (isVc) {
    const engine = getEngine()!;
    engine.persist_vc_state(vcId);
    const {
      minimal_def: { name: nodeType },
    } = JSON.parse(localStorage[`vc_${vcId}`]) as ViewContextDefinition;
    const stateKey = engine.get_state_key(vcId);
    const serializedState = localStorage[stateKey];
    let displayName = ViewContextDescriptors.find(d => d.name === nodeType)?.displayName;
    if (!displayName) {
      console.error(`No descriptor for node type ${nodeType} when duplicating node`);
      displayName = nodeType;
    }

    createdVcId = engine.create_view_context(nodeType, displayName, serializedState);
  } else {
    const innerNode: ForeignNode = (node as any).connectables.node!;
    const nodeType = innerNode.nodeType;
    if (!nodeType) {
      throw new Error("Missing node type; dod't think this happened.");
    }

    const activeSubgraphID = getState().viewContextManager.activeSubgraphID;
    const serialized = innerNode.serialize();
    createdVcId = createNode(nodeType, activeSubgraphID, serialized);
  }

  // VCs are created on the Rust side and are sync'd to Redux as a side effect.
  //
  // FCs are created by adding them to the patch network in Redux state which is then sync'd
  // to the Rust side for persistence.
  //
  // Whenever Redux is updated, the graph editor will diff its nodes + connections against
  // what's in Redux and create/delete/update its nodes + connections accordingly.
  //
  // Entries in this map will be used to place the newly created node once that happens.
  if (pos) {
    InitialPosByVcID.set(createdVcId, pos);
  }

  return createdVcId;
};

const duplicateSubgraph = (subgraphID: string) => {
  persistAllVCsAndFCs();
  const subgraphName =
    getState().viewContextManager.subgraphsByID[subgraphID]?.name ?? 'Cloned Subgraph';
  const serializedSubgraph = getEngine()!.serialize_subgraph(subgraphID, subgraphName);

  getEngine()!.load_serialized_subgraph(serializedSubgraph);
};

/**
 * Positions every node in a more readable manner
 *
 * Copied from LiteGraph source code to add the third and fourth arguments.
 *
 * If `nodeIDs` is set, then only those nodes will be arranged.
 */
LGraph.prototype.arrange = function (
  this: LGraph,
  margin?: number | undefined,
  layout?: string | undefined,
  nodeIDs?: string[] | null | undefined,
  offset?: [number, number] | undefined
) {
  margin = margin || 100;

  let nodes: LGraphNode[] = this.computeExecutionOrder(false, true);
  if (nodeIDs) {
    nodes = nodes.filter(node => nodeIDs.includes(node.id.toString()));
  }
  const columns: any[][] = [];
  for (let i = 0; i < nodes.length; ++i) {
    const node = nodes[i];
    const col = (node as any)._level || 1;
    if (!columns[col]) {
      columns[col] = [];
    }
    columns[col].push(node);
  }

  let x = margin;
  const VERTICAL_LAYOUT = (LiteGraph as any).VERTICAL_LAYOUT;

  for (let i = 0; i < columns.length; ++i) {
    const column = columns[i];
    if (!column) {
      continue;
    }
    let max_size = 100;
    let y = margin + LiteGraph.NODE_TITLE_HEIGHT;
    for (let j = 0; j < column.length; ++j) {
      const node = column[j];
      node.pos[0] = (layout == VERTICAL_LAYOUT ? y : x) + (offset?.[0] ?? 0);
      node.pos[1] = (layout == VERTICAL_LAYOUT ? x : y) + (offset?.[1] ?? 0);
      const max_size_index = layout == VERTICAL_LAYOUT ? 1 : 0;
      if (node.size[max_size_index] > max_size) {
        max_size = node.size[max_size_index];
      }
      const node_size_index = layout == VERTICAL_LAYOUT ? 0 : 1;
      y += node.size[node_size_index] + margin + LiteGraph.NODE_TITLE_HEIGHT;
    }
    x += max_size + margin;
  }

  this.setDirtyCanvas(true, true);
};

LGraphCanvas.prototype.getCanvasMenuOptions = () => [];
const oldGetNodeMenuOptions = LGraphCanvas.prototype.getNodeMenuOptions;
LGraphCanvas.prototype.getNodeMenuOptions = function (this: LGraphCanvas, node: LGraphNode) {
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
  let filteredOptions = options.filter(item => {
    if (!item) {
      return true;
    }
    if (OptionsToRemove.includes(item.content)) {
      return false;
    }

    return true;
  });

  // Remove duplicate subsequent nulls which map to dividers in the menu
  filteredOptions = filteredOptions.filter((opt, i) => {
    if (i > 0 && opt === null && filteredOptions[i - 1] === null) {
      return false;
    }
    return true;
  });

  const removeOption = filteredOptions.find(opt => opt?.content === 'Remove');
  if (!removeOption) {
    throw new Error('Failed to find "Remove" option in node menu');
  }

  const innerNode = ((node as any).connectables as AudioConnectables | undefined)?.node;
  if (innerNode && innerNode instanceof SubgraphPortalNode) {
    // If this portal is linking to the root node, don't allow deletion
    if (innerNode.rxSubgraphID === NIL_UUID) {
      filteredOptions = filteredOptions.filter(opt => opt?.content !== 'Remove');
    } else {
      // Replace the "Remove" option with "Delete Subgraph"
      removeOption.content = 'Delete Subgraph';
      removeOption.callback = () =>
        void confirmAndDeleteSubgraph((innerNode as SubgraphPortalNode).rxSubgraphID);

      // Add "Save Subgraph" and "Duplicate Subgraph" options after the "Delete Subgraph" option
      filteredOptions.splice(
        filteredOptions.indexOf(removeOption) + 1,
        0,
        {
          content: 'Save Subgraph',
          callback: () => void saveSubgraphPreset(innerNode.rxSubgraphID),
        },
        {
          content: 'Duplicate Subgraph',
          callback: () => void duplicateSubgraph(innerNode.rxSubgraphID),
        }
      );
    }
  } else {
    // Patch the remove option to delete the node directly from the patch network

    removeOption.callback = (_value, _options, _event, _parentMenu, node) => {
      const vcId = node.id.toString();
      const isVc = vcId.length === 36;
      if (isVc) {
        getEngine()!.delete_vc_by_id(vcId);
      } else {
        removeNode(vcId);
      }
    };
  }

  const selectedNodeCount = Object.keys(this.selected_nodes).length;
  const moveToSubgraph = {
    content: selectedNodeCount > 1 ? 'Move Selected to Subgraph' : 'Move to Subgraph',
    callback: (_menuEntry: any, _options: any, event: any, parentMenu: ContextMenu) => {
      const activeSubgraphID = getState().viewContextManager.activeSubgraphID;
      const validMoveToSubgraphs = R.sortWith(
        [R.ascend(([_id, desc]) => desc.name.toLocaleLowerCase())],
        Object.entries(getState().viewContextManager.subgraphsByID).filter(
          ([id]) => id !== activeSubgraphID
        )
      );
      new LiteGraph.ContextMenu(
        [
          ...validMoveToSubgraphs.map(([id, desc]) => ({ title: desc.name, content: id })),
          { title: 'New Subgraph', content: 'NEW_SUBGRAPH' },
        ],
        {
          event: event,
          callback: ({ content }: { title: string; content: string }) => {
            const targetSubgraphID = content === 'NEW_SUBGRAPH' ? addSubgraph() : content;
            const selectedVFcIds = Object.keys(this.selected_nodes);
            setTimeout(() => {
              getEngine()!.move_vfcs_to_subgraph(JSON.stringify(selectedVFcIds), targetSubgraphID);
              getSentry()?.captureMessage('Moved nodes to subgraph');
            });
          },
          parentMenu,
        }
      );
    },
  };

  const duplicate = {
    content: selectedNodeCount > 1 ? 'Duplicate Selected Nodes' : 'Duplicate Node',
    callback: (
      _menuEntry: any,
      { event }: { event: MouseEvent & { canvasX: number; canvasY: number } }
    ) => {
      const basePos = [event.canvasX, event.canvasY + 180];
      const nodesToDuplicate = Object.values(this.selected_nodes);
      if (nodesToDuplicate.length === 0) {
        return;
      }

      const newIDByOldID: Map<string, string> = new Map();

      const baseNodePos = nodesToDuplicate[0].pos;
      for (const node of nodesToDuplicate) {
        const pos = {
          x: basePos[0] + node.pos[0] - baseNodePos[0],
          y: basePos[1] + node.pos[1] - baseNodePos[1],
        };
        const newID = duplicateNode(node, pos);
        newIDByOldID.set(node.id.toString(), newID);
      }

      const srcNodeIDs = new Set();
      for (const node of nodesToDuplicate) {
        const vcId = node.id.toString();
        srcNodeIDs.add(vcId);
      }

      // re-create connections between duplicated nodes
      const intraConnections = getState().viewContextManager.patchNetwork.connections.filter(
        ([{ vcId: txId }, { vcId: rxId }]) => srcNodeIDs.has(txId) && srcNodeIDs.has(rxId)
      );
      setTimeout(() => {
        for (const [tx, rx] of intraConnections) {
          const txId = newIDByOldID.get(tx.vcId);
          const rxId = newIDByOldID.get(rx.vcId);
          if (txId && rxId) {
            connect({ ...tx, vcId: txId }, { ...rx, vcId: rxId });
          }
        }
      });
    },
  };

  const selectionContainsSubgraphPortalNode = Object.values(this.selected_nodes).some(
    node => ((node as any).connectables as AudioConnectables).node instanceof SubgraphPortalNode
  );
  if (selectionContainsSubgraphPortalNode) {
    // The case of moving subgraphs into other subgraphs is complicated and would require special
    // handling, and I'm not bothering to implement it right now.
    //
    // Also, we have a dedicated option for duplicating subgraphs, so we won't add the VC/FC
    // duplicate option either.
  } else if (Object.keys(this.selected_nodes).length > 1) {
    const alignSelectedToIx = filteredOptions.findIndex(
      opt => opt?.content === 'Align Selected To'
    );
    if (alignSelectedToIx === -1) {
      throw new Error('Failed to find "Align Selected To" option in node menu');
    }
    filteredOptions.splice(alignSelectedToIx + 1, 0, moveToSubgraph, duplicate);
  } else {
    // Put before "Remove"
    const removeOptionIx = filteredOptions.indexOf(removeOption);
    if (removeOptionIx === -1) {
      console.error(
        'Failed to find "Remove" option in node menu; not adding "Move to Subgraph" option'
      );
    } else {
      filteredOptions.splice(removeOptionIx, 0, moveToSubgraph, duplicate, null);
    }
  }

  while (filteredOptions[0] === null) {
    filteredOptions.splice(0, 1);
  }

  return filteredOptions;
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
        throw new UnreachableError(`Unknown menu option: ${label}`);
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

  ((node as any).connectables as AudioConnectables | undefined)?.node?.onNodeDblClicked?.();
};

// Prevent litegraph from swallowing mouse navigation events
const oldAdjustMouseEvent = LGraphCanvas.prototype.adjustMouseEvent;
LGraphCanvas.prototype.adjustMouseEvent = function (this: LGraphCanvas, evt: any) {
  oldAdjustMouseEvent.apply(this, [evt]);
  if (evt.type === 'mouseup' && (evt.which === 4 || evt.which === 5)) {
    handleGlobalMouseDown(evt);
  }
};

/**
 * Mapping of `stateKey`s to the graph instances that that they manage
 */
export const GraphEditorInstances: Map<string, LGraph> = new Map();
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
  (state as any).selectedNodeVcId = Object.values(selectedNodes)[0]?.connectables?.vcId;

  localStorage.setItem(stateKey, JSON.stringify(state));
};

const getLGNodesByVcId = (vcId: string) => {
  const nodes = [];

  for (const instance of GraphEditorInstances.values()) {
    if ((instance as any as LiteGraphInstance)._nodes_by_id[vcId]) {
      const node = (instance as any as LiteGraphInstance)._nodes_by_id[vcId];
      if (node) {
        nodes.push(node);
      }
    }
  }

  return nodes;
};

const FlowingIntervalHandles = new Map<string, NodeJS.Timeout>();
export const setConnectionFlowingStatus = (
  vcId: string,
  outputName: string,
  isFlowing: boolean
) => {
  if (!isFlowing) {
    const nodes = getLGNodesByVcId(vcId);
    for (const node of nodes) {
      const outputIx = node?.outputs?.findIndex(R.propEq(outputName, 'name')) ?? -1;
      if (!!node && outputIx !== -1) {
        node.clearTriggeredSlot(outputIx);
      }
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
    const nodes = getLGNodesByVcId(vcId);

    for (const node of nodes) {
      const outputIx = node?.outputs?.findIndex(R.propEq(outputName, 'name')) ?? -1;

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
    }
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

/**
 *
 * @returns An array of tuples of the form [displayName, nodeType] for all VCs as well as
 *          foreign graph editor connectables nodes.
 */
const buildSortedNodeEntries = () => {
  const nodeEntries = Object.entries(LiteGraph.registered_node_types)
    .filter(
      ([key, NodeClass]) =>
        key.startsWith('customAudio/') && (NodeClass as any).manuallyCreatable !== false
    )
    .map(([key, NodeClass]) => [(NodeClass as any).typeName as string, key] as const);
  const vcEntries = ViewContextDescriptors.map(vc => [vc.displayName, vc.name] as const);
  return R.sortBy(([name]) => name.toLowerCase(), [...nodeEntries, ...vcEntries]);
};

/**
 *
 * @param nodeType The node type from `buildSortedNodeEntries`
 * @returns The created node's ID
 */
const createNode = (
  nodeType: string,
  subgraphId: string,
  params?: Record<string, any> | null
): string => {
  const isVc = !nodeType.startsWith('customAudio/');
  if (isVc) {
    const engine = getEngine();
    if (!engine) {
      throw new Error('Engine not initialized when creating a VC from the graph editor');
    }

    const desc =
      ViewContextDescriptors.find(d => d.nameAlias === nodeType) ??
      ViewContextDescriptors.find(d => d.name === nodeType);
    if (!desc) {
      throw new UnreachableError(`Could not find VC descriptor for ${nodeType}`);
    }
    return engine.create_view_context(
      desc.nameAlias ?? desc.name,
      desc.displayName,
      desc.initialState
    );
  }

  const id = buildNewForeignConnectableID().toString();
  // TODO: will also need to handle virtual FCs here
  const node = new audioNodeGetters[nodeType]!.nodeGetter(ctx, id, params);
  const connectables = node.buildConnectables();
  dispatch(actionCreators.viewContextManager.ADD_PATCH_NETWORK_NODE(id, connectables, subgraphId));
  return id;
};

/**
 * Adds a new subgraph to the engine and creates a subgraph portal node in the current graph so that
 * the new subgraph can be moved into and connected to.
 */
const addSubgraph = () => getEngine()!.add_subgraph();

const addSavedSubgraph = async () => {
  let pickedPreset: PresetDescriptor<number>;
  try {
    pickedPreset = await renderModalWithControls(
      mkGenericPresetPicker(() =>
        fetchSubgraphPresets().then(presets => presets.map(p => ({ ...p, preset: p.id })))
      )
    );
  } catch (_err) {
    return; // cancelled
  }

  try {
    const preset = await getSubgraphPreset(pickedPreset.id);
    getEngine()!.load_serialized_subgraph(JSON.stringify(preset));
  } catch (err) {
    logError('Error fetching subgraph preset', err);
    toastError('Error fetching subgraph preset: ' + `${err}`);
  }
};

interface GraphControlsProps {
  lGraphInstance: LGraph | null;
}

const GraphControls: React.FC<GraphControlsProps> = ({ lGraphInstance }) => {
  const selectedNodeType = useRef<string>('customAudio/LFO');

  const settings = useMemo(() => {
    const sortedNodeEntries = buildSortedNodeEntries();

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
        action: () =>
          createNode(selectedNodeType.current, getState().viewContextManager.activeSubgraphID),
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

interface GraphEditorProps {
  stateKey: string;
}

const GraphEditor: React.FC<GraphEditorProps> = ({ stateKey }) => {
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
  const vcId = stateKey.split('_')[1];
  const { patchNetwork, activeViewContexts, foreignConnectables, isLoaded, subgraphID } =
    useSelector((state: ReduxStore) => {
      const subgraphID = state.viewContextManager.activeViewContexts.find(
        vc => vc.uuid === vcId
      )?.subgraphId;

      return {
        ...R.pick(
          ['patchNetwork', 'activeViewContexts', 'foreignConnectables', 'isLoaded'],
          state.viewContextManager
        ),
        subgraphID,
      };
    }, shallowEqual);

  const [canvasHeight, setCanvasHeight] = useState(window.innerHeight - 130);
  useEffect(() => {
    const onResize = () => {
      const newHeight = window.innerHeight - 130;
      setCanvasHeight(newHeight);
      const newWidth = curSelectedNodeRef.current
        ? window.innerWidth - 500 - 44
        : window.innerWidth - 44;

      const isHidden = getIsVcHidden(vcId);
      if (isHidden) {
        deferredSize.current = { width: newWidth, height: newHeight };
      } else {
        lGraphCanvasRef.current?.resize(newWidth, newHeight);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [vcId]);

  const smallViewDOMId = `graph-editor_${vcId}_small-view-dom-id`;

  const deferredSize = useRef<{ width: number; height: number } | undefined>();
  useEffect(() => {
    if (!lGraphInstance) {
      return;
    }

    const cb = (isHidden: boolean) => {
      if (isHidden) {
        lGraphInstance.stop();
      } else {
        lGraphInstance.start();

        if (deferredSize.current) {
          lGraphCanvasRef.current?.resize(deferredSize.current.width, deferredSize.current.height);
          deferredSize.current = undefined;
        }
      }
    };

    registerVcHideCb(vcId, cb);
    return () => unregisterVcHideCb(vcId, cb);
  }, [vcId, lGraphInstance]);

  useEffect(() => {
    if (lGraphInstance) {
      setLGraphHandle(vcId, lGraphInstance);

      // If the graph editor isn't visible, make sure we stop its rendering to save resources
      const { activeViewContextId } = getState().viewContextManager;
      if (activeViewContextId !== vcId) {
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
      (graph as any).subgraphID = subgraphID;
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
      canvas.title_text_font = '15px "IBM Plex Sans", Arial, sans-serif';
      // canvas.inner_text_font = 'normal 12px "IBM Plex Sans"';
      // canvas.ctx.letterSpacing = '-0.5px';
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
      (graph as any).onNodeRemoved = (node: LGraphNode) => {
        handleNodeSelectAction({
          smallViewDOMId,
          lgNode: node,
          setCurSelectedNode,
          setSelectedNodeVCID,
          isNowSelected: false,
          curSelectedNodeRef,
        });
      };

      const sortedNodeEntries = [
        ['Add Empty Subgraph', 'ADD_EMPTY_SUBGRAPH'],
        ['Add Saved Subgraph', 'ADD_SAVED_SUBGRAPH'],
        ['---', '---'],
        ...buildSortedNodeEntries(),
      ];
      const displayNames = sortedNodeEntries.map(([displayName]) => displayName);
      const lowerDisplayNames = displayNames.map(displayName => displayName.toLowerCase());
      canvas.onSearchBox = (_helper, value, _graphCanvas) => {
        if (!value) {
          return [...displayNames];
        }

        const lowerValue = value.toLowerCase().trim();
        return displayNames.filter((_displayName, i) => lowerDisplayNames[i].includes(lowerValue));
      };
      canvas.onSearchBoxSelection = (name, _evt, _graphCanvas) => {
        const unescapedName = unescapeHTML(name);
        const entry = sortedNodeEntries.find(([displayName]) => displayName === unescapedName);
        if (!entry) {
          throw new Error(`No entry found for node type "${unescapedName}"`);
        }
        const [, nodeType] = entry;
        if (!nodeType || nodeType === '---') {
          return;
        } else if (nodeType === 'ADD_EMPTY_SUBGRAPH') {
          addSubgraph();
        } else if (nodeType === 'ADD_SAVED_SUBGRAPH') {
          addSavedSubgraph();
        } else {
          if (!subgraphID) {
            throw new Error('No subgraph ID');
          }
          createNode(nodeType, subgraphID);
        }
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
  }, [curSelectedNode, setCurSelectedNode, smallViewDOMId, stateKey, subgraphID, vcId]);

  useEffect(() => {
    if (!lGraphInstance || !subgraphID) {
      return;
    }

    updateGraph(
      lGraphInstance as any as LiteGraphInstance,
      patchNetwork,
      activeViewContexts,
      foreignConnectables,
      subgraphID
    );

    // If there is a currently selected node, it may have been de-selected as a result of being modified.  Try
    // to re-select it if it still exists.
    if (R.isNil(selectedNodeVCID)) {
      return;
    }

    const node = (lGraphInstance as any)._nodes.find(
      (node: LiteGraphConnectablesNode) => node.connectables?.vcId === selectedNodeVCID
    );
    if (!node) {
      setSelectedNodeVCID(null);
      return;
    }

    setCurSelectedNode(node);
    lGraphInstance.list_of_graphcanvas?.[0]?.selectNodes([node]);
    lGraphInstance.list_of_graphcanvas?.[0]?.onNodeSelected?.(node);
  }, [
    patchNetwork,
    lGraphInstance,
    activeViewContexts,
    selectedNodeVCID,
    setCurSelectedNode,
    subgraphID,
    foreignConnectables,
  ]);

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
      const node = (lGraphInstance as any as LiteGraphInstance)._nodes.find(
        node => node.connectables?.vcId === state.selectedNodeVcId
      ) as any as LGraphNode | undefined;
      setCurSelectedNode(node);
      setSelectedNodeVCID(node ? state.selectedNodeVcId : null);
      if (node) {
        lGraphInstance.list_of_graphcanvas?.[0]?.selectNodes([node]);
        lGraphInstance.list_of_graphcanvas?.[0]?.onNodeSelected?.(node);
      } else {
        console.warn(
          `Failed to find node with ID=${state.selectedNodeVcId} which was marked as selected in the serialized state`
        );
      }
    }

    state.nodes.forEach(({ id, pos }) => {
      const node = (lGraphInstance as any as LiteGraphInstance)._nodes_by_id[id];
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
            <FlatButton onClick={() => getEngine()!.switch_view_context(selectedNodeVCID)}>
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
