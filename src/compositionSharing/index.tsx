import type { Root } from 'react-dom/client';

import { mkContainerHider, mkContainerUnhider } from 'src/reactUtils';

interface CompositionSharingCtx {
  root: Root;
}

const CtxsByVcId: Map<string, CompositionSharingCtx> = new Map();

const buildCompositionSharingDOMNodeID = (vcId: string) => `compositionSharing-${vcId}`;

export const init_composition_sharing = async (stateKey: string) => {
  if ((window as any).isHeadless) {
    return;
  }

  const vcId = stateKey.split('_')[1]!;
  // Create the base dom node to render the composition sharing interface
  const compositionSharingBase = document.createElement('div');
  compositionSharingBase.id = buildCompositionSharingDOMNodeID(vcId);
  compositionSharingBase.setAttribute(
    'style',
    'z-index: 2;width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none'
  );

  document.getElementById('content')!.appendChild(compositionSharingBase);

  const [{ createRoot }, { Provider }, { store }, { default: CompositionSharing }] =
    await Promise.all([
      import('react-dom/client'),
      import('react-redux'),
      import('../redux'),
      import('./CompositionSharing'),
    ]);

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

export const persist_composition_sharing = (_stateKey: string) => {
  // No state to persist currently
};

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
