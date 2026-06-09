import { mkContainerHider, mkContainerUnhider } from 'src/reactUtils';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';

const buildWelcomePageDOMNodeID = (vcId: string) => `welcomePage-${vcId}`;

export const init_welcome_page = async (stateKey: string) => {
  if ((window as any).isHeadless) {
    return;
  }

  const vcId = stateKey.split('_')[1]!;
  const welcomePageBase = document.createElement('div');
  welcomePageBase.id = buildWelcomePageDOMNodeID(vcId);
  welcomePageBase.setAttribute(
    'style',
    'z-index: 2;width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none'
  );

  document.getElementById('content')!.appendChild(welcomePageBase);

  const { default: WelcomePageWrapper } = await import('./WelcomePageWrapper.svelte');
  mkSvelteContainerRenderHelper({ Comp: WelcomePageWrapper, getProps: () => ({ vcId }) })(
    buildWelcomePageDOMNodeID(vcId)
  );
};

export const hide_welcome_page = mkContainerHider(buildWelcomePageDOMNodeID);

export const unhide_welcome_page = mkContainerUnhider(buildWelcomePageDOMNodeID);

export const persist_welcome_page = (_stateKey: string) => {
  // No state to persist currently
};

export const cleanup_welcome_page = (stateKey: string): string => {
  const vcId = stateKey.split('_')[1]!;

  mkSvelteContainerCleanupHelper({ preserveRoot: false })(buildWelcomePageDOMNodeID(vcId));

  return '';
};
