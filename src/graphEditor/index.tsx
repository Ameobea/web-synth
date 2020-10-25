import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import { store } from 'src/redux';
import GraphEditor, { saveStateForInstance } from './GraphEditor';

const ROOT_NODE_ID = 'graph-editor-react-root' as const;

export const init_graph_editor = (stateKey: string) => {
  // Create the base dom node for the faust editor
  const graphEditorBaseNode = document.createElement('div');
  graphEditorBaseNode.id = ROOT_NODE_ID;
  graphEditorBaseNode.setAttribute(
    'style',
    'z-index: 2; height: calc(100vh - 40px); position: absolute; top: 0; left: 0;'
  );

  // Mount the newly created graph editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(graphEditorBaseNode);
  ReactDOM.render(
    <Provider store={store}>
      <GraphEditor stateKey={stateKey} />
    </Provider>,
    graphEditorBaseNode
  );
};

export const hide_graph_editor = (vcId: string) => {
  const rootNode = document.getElementById(ROOT_NODE_ID);
  if (!rootNode) {
    console.warn(`Tried to hide graph editor with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'none';
};

export const unhide_graph_editor = (vcId: string) => {
  const rootNode = document.getElementById(ROOT_NODE_ID);
  if (!rootNode) {
    console.warn(`Tried to unhide graph editor with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'block';
};

export const cleanup_graph_editor = (stateKey: string) => {
  const graphEditorReactRootNode = document.getElementById(ROOT_NODE_ID);
  // Trigger the graph editor to save its state before its destruction.  `unmountComponentAtNode`
  // doesn't seem to trigger lifecycle methods/execute the return value of `useEffect` so we have
  // to handle this explicitly.
  saveStateForInstance(stateKey);
  if (graphEditorReactRootNode) {
    ReactDOM.unmountComponentAtNode(graphEditorReactRootNode);
    graphEditorReactRootNode.remove();
  }
};
