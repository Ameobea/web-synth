import type { LGraph } from 'litegraph.js';
import * as R from 'ramda';

import type { LiteGraph as LiteGraphInstance } from 'src/graphEditor/LiteGraphTypes';

export const GraphEditorInstances: Map<string, LGraph> = new Map();
(window as any).GraphEditorInstances = GraphEditorInstances;

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
  if ((window as any).isHeadless) {
    return;
  }

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
    // If the whole graph editor / node went away, `nodes` is empty and the per-node clearing branch
    // below never runs — clear the interval here so it doesn't tick forever.
    if (nodes.length === 0) {
      const intervalHandle = FlowingIntervalHandles.get(vcId);
      if (!R.isNil(intervalHandle)) {
        clearInterval(intervalHandle);
        FlowingIntervalHandles.delete(vcId);
      }
      return;
    }

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
