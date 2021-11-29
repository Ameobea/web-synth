import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import { store } from '../redux';
import CompositionSharing from './CompositionSharing';
import { getEngine } from 'src/util';
import { mkContainerHider, mkContainerUnhider } from 'src/reactUtils';

interface CompositionSharingCtx {
  root: ReactDOM.Root;
}

const CtxsByVcId: Map<string, CompositionSharingCtx> = new Map();

const buildCompositionSharingDOMNodeID = (vcId: string) => `compositionSharing-${vcId}`;

export const init_composition_sharing = (stateKey: string) => {
  console.log('init compo sharing');
  const vcId = stateKey.split('_')[1]!;
  // Create the base dom node to render the composition sharing interface
  const compositionSharingBase = document.createElement('div');
  compositionSharingBase.id = buildCompositionSharingDOMNodeID(vcId);
  compositionSharingBase.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: 100vh; position: absolute; top: 0; left: 0; display: none'
  );

  document.getElementById('content')!.appendChild(compositionSharingBase);

  const engine = getEngine();
  if (!engine) {
    throw new Error('`engine` is unset');
  }
  const root = ReactDOM.createRoot(compositionSharingBase);
  root.render(
    <Provider store={store}>
      <CompositionSharing engine={engine} />
    </Provider>
  );

  const ctx = { root };
  CtxsByVcId.set(vcId, ctx);
};

export const hide_composition_sharing = mkContainerHider(buildCompositionSharingDOMNodeID);

export const unhide_composition_sharing = mkContainerUnhider(buildCompositionSharingDOMNodeID);

export const cleanup_composition_sharing = (stateKey: string): string => {
  console.log('cleanup compo sharing');
  const vcId = stateKey.split('_')[1]!;
  const ctx = CtxsByVcId.get(vcId);
  if (!ctx) {
    console.error(`No composition sharing ctx found for stateKey=${stateKey} when cleaning up`);
    return '';
  }

  ctx.root.unmount();
  const compositionSharingRootNode = document.getElementById(
    buildCompositionSharingDOMNodeID(vcId)
  );
  compositionSharingRootNode?.remove();
  CtxsByVcId.delete(vcId);

  return '';
};
