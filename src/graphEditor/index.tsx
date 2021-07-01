import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import { mkContainerHider, mkContainerUnhider } from 'src/reactUtils';
import { store } from 'src/redux';
import { retryAsync } from 'src/util';
import GraphEditor, { saveStateForInstance } from './GraphEditor';

export const LGraphHandlesByVcId: Map<string, any> = new Map();

export const init_graph_editor = (stateKey: string) => {
  // Create the base dom node for the faust editor
  const graphEditorBaseNode = document.createElement('div');
  graphEditorBaseNode.id = stateKey;
  graphEditorBaseNode.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 40px); position: absolute; top: 0; left: 0;'
  );

  // Mount the newly created graph editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(graphEditorBaseNode);
  // Using non-concurrent mode here because concurrent mode makes the canvas dissappear for an
  // instant when changing small views sometimes
  ReactDOM.render(
    <Provider store={store}>
      <GraphEditor stateKey={stateKey} />
    </Provider>,
    graphEditorBaseNode
  );
};

export const hide_graph_editor = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const inst = LGraphHandlesByVcId.get(vcId);
  // Stop rendering when not visible to save resources
  inst?.list_of_graphcanvas?.forEach((canvas: any) => {
    canvas.stopRendering();
    canvas.pause_rendering = true;
  });
  mkContainerHider(vcId => `graphEditor_${vcId}`)(stateKey);
};

export const unhide_graph_editor = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const inst = LGraphHandlesByVcId.get(vcId);
  // Resume rendering now that the graph editor is visible
  inst?.list_of_graphcanvas?.forEach((canvas: any) => {
    canvas.startRendering();
    canvas.pause_rendering = false;
  });
  mkContainerUnhider(vcId => `graphEditor_${vcId}`)(stateKey);
};

export const cleanup_graph_editor = (stateKey: string) => {
  const graphEditorReactRootNode = document.getElementById(stateKey);
  // Trigger the graph editor to save its state before its destruction.  `unmountComponentAtNode`
  // doesn't seem to trigger lifecycle methods/execute the return value of `useEffect` so we have
  // to handle this explicitly.
  saveStateForInstance(stateKey);
  if (graphEditorReactRootNode) {
    ReactDOM.unmountComponentAtNode(graphEditorReactRootNode);
    graphEditorReactRootNode.remove();
  }
};

export const arrange_graph_editor = (vcId: string) => {
  const inner = async () => {
    const instance = LGraphHandlesByVcId.get(vcId);
    if (!instance) {
      throw `Tried to arrange lgraph with vcId=${vcId} but no entry is registered`;
    }
    instance.arrange();
  };
  // It takes a little bit of time for the graph editor to initialize and the instance to be registered after
  // committing from the VCM, so we account for that here.
  retryAsync(inner, 10, 100);
};
