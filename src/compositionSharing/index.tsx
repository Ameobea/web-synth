import React from 'react';
import ReactDOM from 'react-dom';

import { store } from '../redux';
import CompositionSharing from './CompositionSharing';
import { Provider } from 'react-redux';
import { getEngine } from '..';
import { mkContainerHider, mkContainerUnhider } from 'src/reactUtils';

const ROOT_NODE_ID = 'composition-sharing-react-root' as const;

export const init_composition_sharing = (_stateKey: string) => {
  // Create the base dom node for the faust editor
  const faustEditorBase = document.createElement('div');
  faustEditorBase.id = ROOT_NODE_ID;
  faustEditorBase.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: 100vh; position: absolute; top: 0; left: 0;'
  );

  // Mount the newly created Faust editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(faustEditorBase);

  const engine = getEngine();
  if (!engine) {
    throw new Error('`engine` is unset');
  }
  ReactDOM.render(
    <Provider store={store}>
      <CompositionSharing engine={engine} />
    </Provider>,
    faustEditorBase
  );
};

export const hide_composition_sharing = mkContainerHider(() => ROOT_NODE_ID);

export const unhide_composition_sharing = mkContainerUnhider(() => ROOT_NODE_ID);

export const cleanup_composition_sharing = (): string => {
  const compositionSharingRootNode = document.getElementById(ROOT_NODE_ID);
  if (compositionSharingRootNode) {
    ReactDOM.unmountComponentAtNode(compositionSharingRootNode);
    compositionSharingRootNode.remove();
  }

  return '';
};
