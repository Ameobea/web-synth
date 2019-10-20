import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { Map } from 'immutable';

import { actionCreators, dispatch, store, getState } from '../redux';
import FaustEditor from './FaustEditor';
import { AudioConnectables, create_empty_audio_connectables } from 'src/patchNetwork';
import { FaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';

const ROOT_NODE_ID = 'faust-editor-react-root' as const;

/**
 * Map holding references to Faust editor audio nodes for use in creating audio connectables
 */
export const faustAudioNodesMap: { [vcId: string]: FaustWorkletNode } = {};

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
      <FaustEditor vcId={stateKey.split('_')[1]} />
    </Provider>,
    faustEditorBase
  );
};

// TODO: This needs to be instanced by VC ID
export const get_faust_editor_content = (_vcId: string) => getState().faustEditor.editorContent;

export const hide_faust_editor = (vcId: string) => {
  const rootNode = document.getElementById(ROOT_NODE_ID);
  if (!rootNode) {
    console.warn(`Tried to hide faust editor with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'none';
};

export const unhide_faust_editor = (vcId: string) => {
  const rootNode = document.getElementById(ROOT_NODE_ID);
  if (!rootNode) {
    console.warn(`Tried to unhide faust editor with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'block';
};

export const cleanup_faust_editor = (vcId: string): string => {
  const editorContent = get_faust_editor_content(vcId);
  const faustEditorReactRootNode = document.getElementById(ROOT_NODE_ID);
  if (!faustEditorReactRootNode) {
    return editorContent;
  }

  delete faustAudioNodesMap[vcId];

  ReactDOM.unmountComponentAtNode(faustEditorReactRootNode);
  faustEditorReactRootNode.remove();
  return editorContent;
};

export const get_faust_editor_connectables = (vcId: string): AudioConnectables => {
  const faustNode = faustAudioNodesMap[vcId];
  if (!faustNode) {
    console.error(`Unable to find Faust node ref for vc id ${vcId}`);
    return create_empty_audio_connectables(vcId);
  }

  return {
    vcId,
    inputs: Map<string, AudioParam | AudioNode>().set('input', faustNode),
    outputs: Map<string, AudioNode>().set('input', faustNode),
  };
};
