import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import { actionCreators, dispatch, store, getState } from '../redux';
import FaustEditor from './FaustEditor';

export const init_faust_editor = (stateKey: string) => {
  // Retrieve the initial editor content from `localStorage` (if it's set) and set it into Redux
  const editorContent = localStorage.getItem(stateKey) || '';
  dispatch(actionCreators.faustEditor.SET_EDITOR_CONTENT(editorContent));

  // Create the base dom node for the faust editor
  const faustEditorBase = document.createElement('div');
  faustEditorBase.id = 'faust-editor-react-root';
  faustEditorBase.setAttribute(
    'style',
    'z-index: 2; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0;'
  );

  // Mount the newly created Faust editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(faustEditorBase);
  ReactDOM.render(
    <Provider store={store}>
      <FaustEditor />
    </Provider>,
    faustEditorBase
  );
};

export const get_faust_editor_content = () => getState().faustEditor.editorContent;

export const cleanup_faust_editor = (): string => {
  const editorContent = get_faust_editor_content();
  const faustEditorReactRootNode = document.getElementById('faust-editor-react-root');
  if (!faustEditorReactRootNode) {
    return editorContent;
  }

  ReactDOM.unmountComponentAtNode(faustEditorReactRootNode);
  faustEditorReactRootNode.remove();
  return editorContent;
};
