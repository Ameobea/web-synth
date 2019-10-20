import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import { store } from 'src/redux';
import GraphEditor, { saveStateForInstance } from './GraphEditor';

export const init_graph_editor = (stateKey: string) => {
  // Create the base dom node for the faust editor
  const graphEditorBaseNode = document.createElement('div');
  graphEditorBaseNode.id = 'graph-editor-react-root';
  graphEditorBaseNode.setAttribute(
    'style',
    'z-index: 2; width: 100vw; height: calc(100vh - 40px); position: absolute; top: 0; left: 0;'
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

export const cleanup_graph_editor = (stateKey: string) => {
  const graphEditorReactRootNode = document.getElementById('graph-editor-react-root');
  // Trigger the graph editor to save its state before its destruction.  `unmountComponentAtNode`
  // doesn't seem to trigger lifecycle methods/execute the return value of `useEffect` so we have
  // to handle this explicitly.
  saveStateForInstance(stateKey);
  if (graphEditorReactRootNode) {
    ReactDOM.unmountComponentAtNode(graphEditorReactRootNode);
    graphEditorReactRootNode.remove();
  }
};
