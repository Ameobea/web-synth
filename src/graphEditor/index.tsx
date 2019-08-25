import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import { store } from '../redux';
import GraphEditor from './GraphEditor';

export const init_graph_editor = (_stateKey: string) => {
  // Retrieve the initial editor content from `localStorage` (if it's set) and set it into Redux
  // const editorContent = localStorage.getItem(stateKey) || '';
  // store.dispatch(actionCreators.setEditorContent(editorContent));

  // Create the base dom node for the faust editor
  const graphEditorBaseNode = document.createElement('div');
  graphEditorBaseNode.id = 'graph-editor-react-root';
  graphEditorBaseNode.setAttribute(
    'style',
    'z-index: 2; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0;'
  );

  // Mount the newly created graph editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(graphEditorBaseNode);
  ReactDOM.render(
    <Provider store={store}>
      <GraphEditor />
    </Provider>,
    graphEditorBaseNode
  );
};

export const cleanup_graph_editor = (): string => {
  const graphEditorReactRootNode = document.getElementById('graph-editor-react-root')!;
  ReactDOM.unmountComponentAtNode(graphEditorReactRootNode);
  graphEditorReactRootNode.remove();
  return ''; // TODO;
};

export const get_graph_editor_content = (): string => {
  return ''; // TODO
};
