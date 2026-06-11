import type { Root } from 'react-dom/client';

import { mkContainerHider, mkContainerUnhider } from 'src/reactUtils';
import { getState, store } from 'src/redux';
import { GraphEditorInstances, saveStateForInstance } from 'src/graphEditor/instances';
import { tryParseJson } from 'src/util';
import type { LGraph } from 'litegraph.js';

interface GraphEditorCtx {
  lgraphHandle: LGraph | null;
  root: Root;
}

export const GraphEditorCtxsByVcId: Map<string, GraphEditorCtx> = new Map();

export const setLGraphHandle = (vcId: string, lgraphHandle: any) => {
  const ctx = GraphEditorCtxsByVcId.get(vcId);
  if (!ctx) {
    console.error(`No graph editor ctx found with vcId=${vcId} when trying to set lgraph handle`);
    return;
  }

  ctx.lgraphHandle = lgraphHandle;
};

export const init_graph_editor = (stateKey: string) => {
  // The graph editor has no audio connectables of its own (foreign connectables live in the
  // patch network), so it can be skipped entirely in headless mode.
  if ((window as any).isHeadless) {
    return;
  }

  const vcId = stateKey.split('_')[1]!;
  // Create the base dom node for the faust editor
  const graphEditorBaseNode = document.createElement('div');
  graphEditorBaseNode.id = stateKey;
  graphEditorBaseNode.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 40px); position: absolute; top: 0; left: 0;'
  );

  // Mount the newly created graph editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(graphEditorBaseNode);

  void Promise.all([
    import('./GraphEditor'),
    import('react-dom/client'),
    import('react-redux'),
  ]).then(([{ default: GraphEditor }, { createRoot }, { Provider }]) => {
    if (!graphEditorBaseNode.isConnected) {
      return;
    }

    // Using non-concurrent mode here because concurrent mode makes the canvas dissappear for an
    // instant when changing small views sometimes
    const root = createRoot(graphEditorBaseNode);
    GraphEditorCtxsByVcId.set(vcId, { lgraphHandle: null, root });
    root.render(
      <Provider store={store}>
        <GraphEditor stateKey={stateKey} />
      </Provider>
    );
  });
};

export const hide_graph_editor = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const inst = GraphEditorCtxsByVcId.get(vcId)?.lgraphHandle;
  // Stop rendering when not visible to save resources
  inst?.list_of_graphcanvas?.forEach((canvas: any) => {
    canvas.stopRendering();
    canvas.pause_rendering = true;
  });
  mkContainerHider(vcId => `graphEditor_${vcId}`)(stateKey);
};

export const unhide_graph_editor = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const inst = GraphEditorCtxsByVcId.get(vcId)?.lgraphHandle;
  // Resume rendering now that the graph editor is visible
  inst?.list_of_graphcanvas?.forEach((canvas: any) => {
    canvas.startRendering();
    canvas.pause_rendering = false;
  });
  mkContainerUnhider(vcId => `graphEditor_${vcId}`)(stateKey);
};

export const persist_graph_editor = (stateKey: string) => {
  if ((window as any).isHeadless) {
    return;
  }
  saveStateForInstance(stateKey);
};

export const cleanup_graph_editor = (stateKey: string) => {
  if ((window as any).isHeadless) {
    return;
  }

  const vcId = stateKey.split('_')[1]!;
  const graphEditorReactRootNode = document.getElementById(stateKey);
  // Trigger the graph editor to save its state before its destruction.  `unmountComponentAtNode`
  // doesn't seem to trigger lifecycle methods/execute the return value of `useEffect` so we have
  // to handle this explicitly.
  saveStateForInstance(stateKey);
  GraphEditorInstances.delete(stateKey);

  const ctx = GraphEditorCtxsByVcId.get(vcId);
  if (!ctx) {
    console.error(`No graph editor ctx found with vcId=${vcId} when trying to set lgraph handle`);
    return;
  }

  ctx.root.unmount();
  graphEditorReactRootNode?.remove();

  GraphEditorCtxsByVcId.delete(vcId);
};

/**
 * First, updates the graph to match the patch network.  Then, arranges the nodes in the graph.  If `nodeIDsOptJSON` is
 * provided, only the nodes with the given IDs will be arranged.  If it is not provided, all nodes will be arranged.
 */
export const arrange_graph_editor_nodes = async (
  vcId: string,
  nodeIDsOptJSON: string,
  offsetX: number,
  offsetY: number
) => {
  if ((window as any).isHeadless) {
    return;
  }

  const nodeIDs = tryParseJson<string[] | null>(
    nodeIDsOptJSON,
    null,
    'Failed to parse node IDs JSON'
  );
  const ctx = GraphEditorCtxsByVcId.get(vcId);
  if (!ctx) {
    console.error(`No graph editor ctx found with vcId=${vcId} when trying to arrange nodes`);
    return;
  }

  const { lgraphHandle } = ctx;
  if (!lgraphHandle) {
    console.warn(`No lgraph handle found for vcId=${vcId} when trying to arrange nodes`);
    return;
  }

  const { updateGraph } = await import('src/graphEditor/graphDiffing');
  const { patchNetwork, activeViewContexts, foreignConnectables } = getState().viewContextManager;
  const subgraphID = activeViewContexts.find(vc => vc.uuid === vcId)!.subgraphId;
  if (!subgraphID) {
    throw new Error(`No subgraph ID found for vcId=${vcId}`);
  }
  updateGraph(
    lgraphHandle as any,
    patchNetwork,
    activeViewContexts,
    foreignConnectables,
    subgraphID
  );

  (lgraphHandle.arrange as any)(undefined, undefined, nodeIDs, [offsetX, offsetY]);
};
