import React from 'react';
import ReactDOM from 'react-dom';

import mkFaustEditor from './FaustEditor';

let state: string;

export const init_faust_editor = (editorContent: string) => {
  state = editorContent || '';

  // Create the base dom node for the faust editor
  const faustEditorBase = document.createElement('div');
  faustEditorBase.id = 'faust-editor-react-root';
  faustEditorBase.setAttribute(
    'style',
    'z-index: 2; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0;'
  );

  document.getElementById('content')!.appendChild(faustEditorBase);

  const FaustEditor = mkFaustEditor(editorContent);
  ReactDOM.render(
    <FaustEditor
      // tslint:disable-next-line:jsx-no-lambda
      onChange={newState => {
        state = newState;
      }}
    />,
    faustEditorBase
  );
};

export const cleanup_faust_editor = (): string => {
  const faustEditorReactRootNode = document.getElementById('faust-editor-react-root')!;
  ReactDOM.unmountComponentAtNode(faustEditorReactRootNode);
  faustEditorReactRootNode.remove();
  return state;
};

export const get_faust_editor_content = () => state;
