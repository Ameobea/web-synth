import React from 'react';
import ReactDOM from 'react-dom';

import { store } from '../redux';
import { actionCreators } from '../redux/reducers/faustEditor';
import FaustEditor from './FaustEditor';
import { Provider } from 'react-redux';

export const init_faust_editor = (stateKey: string) => {
  // Retrieve the initial editor content from `localStorage` (if it's set) and set it into Redux
  const editorContent = localStorage.getItem(stateKey) || '';
  store.dispatch(actionCreators.setEditorContent(editorContent));

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

export const get_faust_editor_content = () => store.getState().faustEditor.editorContent;

export const cleanup_faust_editor = (): string => {
  const faustEditorReactRootNode = document.getElementById('faust-editor-react-root')!;
  ReactDOM.unmountComponentAtNode(faustEditorReactRootNode);
  faustEditorReactRootNode.remove();
  return get_faust_editor_content();
};
