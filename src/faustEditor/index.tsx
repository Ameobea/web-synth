import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { Map } from 'immutable';
import { buildStore } from 'jantix';
import * as R from 'ramda';

import FaustEditor from './FaustEditor';
import { AudioConnectables, ConnectableOutput, ConnectableInput } from 'src/patchNetwork';
import { FaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import { createPassthroughNode } from 'src/graphEditor/nodes/util';
import faustEditorModule from 'src/redux/modules/faustEditor';

const buildRootNodeId = (vcId: string) => `faust-editor-react-root_${vcId}`;

export const faustReduxInfra = buildStore({ faustEditor: faustEditorModule });

/**
 * Map holding references to Faust editor audio nodes for use in creating audio connectables
 */
export const faustAudioNodesMap: {
  [vcId: string]: { analyzerNode: AnalyserNode; faustNode: FaustWorkletNode };
} = {};

export const init_faust_editor = (stateKey: string) => {
  // Retrieve the initial editor content from `localStorage` (if it's set) and set it into Redux
  const editorContent = localStorage.getItem(stateKey) || '';
  faustReduxInfra.dispatch(
    faustReduxInfra.actionCreators.faustEditor.SET_EDITOR_CONTENT(editorContent)
  );

  // Create the base dom node for the faust editor
  const faustEditorBase = document.createElement('div');
  const vcId = stateKey.split('_')[1]!;
  faustEditorBase.id = buildRootNodeId(vcId);
  faustEditorBase.setAttribute(
    'style',
    'z-index: 2; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0; display: none'
  );

  // Mount the newly created Faust editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(faustEditorBase);
  ReactDOM.render(
    <Provider store={faustReduxInfra.store}>
      <FaustEditor vcId={vcId} />
    </Provider>,
    faustEditorBase
  );
};

// TODO: This needs to be instanced by VC ID
export const get_faust_editor_content = (_vcId: string) =>
  faustReduxInfra.getState().faustEditor.editorContent;

export const hide_faust_editor = (vcId: string) => {
  const rootNode = document.getElementById(buildRootNodeId(vcId));
  if (!rootNode) {
    console.warn(`Tried to hide faust editor with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'none';
};

export const unhide_faust_editor = (vcId: string) => {
  const rootNode = document.getElementById(buildRootNodeId(vcId));
  if (!rootNode) {
    console.warn(`Tried to unhide faust editor with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'block';
};

export const cleanup_faust_editor = (vcId: string): string => {
  const editorContent = get_faust_editor_content(vcId);
  const faustEditorReactRootNode = document.getElementById(buildRootNodeId(vcId));
  if (!faustEditorReactRootNode) {
    return editorContent;
  }

  delete faustAudioNodesMap[vcId];

  ReactDOM.unmountComponentAtNode(faustEditorReactRootNode);
  faustEditorReactRootNode.remove();
  return editorContent;
};

export const get_faust_editor_connectables = (vcId: string): AudioConnectables => {
  if (!faustAudioNodesMap[vcId]) {
    // Create passthrough audio node with the same interface as the `FaustAudioWorklet`-based ones that will be created later
    // once our Faust code is compiled.  This should cause any connections made before the faust module is started to be re-
    // connected to the real faust node once it is started.
    const passthroughNode = createPassthroughNode(GainNode);
    return {
      vcId,
      inputs: Map<string, ConnectableInput>().set('input', {
        node: passthroughNode,
        type: 'customAudio',
      }),
      outputs: Map<string, ConnectableOutput>().set('output', {
        node: passthroughNode,
        type: 'customAudio',
      }),
    };
  }

  const { faustNode, analyzerNode } = faustAudioNodesMap[vcId];

  const baseInputs = Map<string, ConnectableInput>().set('input', {
    node: faustNode,
    type: 'customAudio',
  });
  const parseUIItem = (item, pathPrefix = '') =>
    ['vgroup', 'hgroup'].includes(item.type)
      ? item.items.map(childItem =>
          parseUIItem(
            childItem,
            pathPrefix === '' ? `/${item.label}/` : `${pathPrefix}${item.label}/`
          )
        )
      : { ...item, label: `${pathPrefix}${item.label}`.replace(/\s/g, '_') };
  const flattenedUIItems = R.flatten(
    faustNode.jsonDef.ui.map(item => parseUIItem(item, undefined))
  );
  const inputs = flattenedUIItems.reduce(
    (acc: Map<string, ConnectableInput>, item: any) =>
      acc.set(item.label, {
        node: faustNode.parameters.get(item.label.replace(/\s/g, '_') as string),
        type: 'number',
      }),
    baseInputs
  );

  return {
    vcId,
    inputs,
    outputs: Map<string, ConnectableOutput>().set('output', {
      node: analyzerNode,
      type: 'customAudio',
    }),
  };
};
