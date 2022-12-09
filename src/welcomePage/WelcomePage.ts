import { mkContainerHider, mkContainerUnhider } from 'src/reactUtils';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import WelcomePageUI from './WelcomePage.svelte';

interface WelcomePageCtx {}

const CtxsByVcId: Map<string, WelcomePageCtx> = new Map();

const buildWelcomePageDOMNodeID = (vcId: string) => `welcomePage-${vcId}`;

export const init_welcome_page = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  // Create the base dom node to render the composition sharing interface
  const welcomePageBase = document.createElement('div');
  welcomePageBase.id = buildWelcomePageDOMNodeID(vcId);
  welcomePageBase.setAttribute(
    'style',
    'z-index: 2;width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none'
  );

  document.getElementById('content')!.appendChild(welcomePageBase);

  mkSvelteContainerRenderHelper({ Comp: WelcomePageUI, getProps: () => ({}) })(
    buildWelcomePageDOMNodeID(vcId)
  );

  const ctx = {};
  CtxsByVcId.set(vcId, ctx);
};

export const hide_welcome_page = mkContainerHider(buildWelcomePageDOMNodeID);

export const unhide_welcome_page = mkContainerUnhider(buildWelcomePageDOMNodeID);

export const cleanup_welcome_page = (stateKey: string): string => {
  const vcId = stateKey.split('_')[1]!;
  const ctx = CtxsByVcId.get(vcId);
  if (!ctx) {
    console.error(`No welcome page ctx found for stateKey=${stateKey} when cleaning up`);
    return '';
  }

  mkSvelteContainerCleanupHelper({ preserveRoot: false })(buildWelcomePageDOMNodeID(vcId));
  CtxsByVcId.delete(vcId);

  return '';
};
