import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'react-redux';

import { mkContainerHider, mkContainerUnhider } from 'src/reactUtils';
import { store } from '../redux';
import CompositionSharing from './CompositionSharing';

interface CompositionSharingCtx {
  root: Root;
}

const CtxsByVcId: Map<string, CompositionSharingCtx> = new Map();

const buildCompositionSharingDOMNodeID = (vcId: string) => `compositionSharing-${vcId}`;

export const init_composition_sharing = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  // Create the base dom node to render the composition sharing interface
  const compositionSharingBase = document.createElement('div');
  compositionSharingBase.id = buildCompositionSharingDOMNodeID(vcId);
  compositionSharingBase.setAttribute(
    'style',
    'z-index: 2;width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none'
  );

  document.getElementById('content')!.appendChild(compositionSharingBase);

  const root = createRoot(compositionSharingBase);
  root.render(
    <Provider store={store}>
      <CompositionSharing />
    </Provider>
  );

  const ctx = { root };
  CtxsByVcId.set(vcId, ctx);
};

export const hide_composition_sharing = mkContainerHider(buildCompositionSharingDOMNodeID);

export const unhide_composition_sharing = mkContainerUnhider(buildCompositionSharingDOMNodeID);

export const cleanup_composition_sharing = (stateKey: string): string => {
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
