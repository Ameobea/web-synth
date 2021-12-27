import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

const wasm = import('./engine');
import { actionCreators, dispatch, store, getState } from './redux';
import { ViewContextManager, ViewContextSwitcher } from './ViewContextManager';
import type { VCMState } from 'src/redux/modules/viewContextManager';
import { getEngine, setEngine, tryParseJson } from 'src/util';
import { initPatchNetwork } from 'src/patchNetwork';
import type { ConnectableDescriptor } from 'src/patchNetwork';
import BrowserNotSupported from 'src/misc/BrowserNotSupported';
import {
  loadSharedComposition,
  maybeRestoreLocalComposition,
  onBeforeUnload,
} from 'src/persistance';
import { initSentry } from 'src/sentry';
import { getLoadedComposition } from 'src/api';
import {
  onVcHideStatusChange,
  registerMainReduxGetState,
} from 'src/ViewContextManager/VcHideStatusRegistry';

const ctx = new AudioContext();

// Web browsers like to disable audio contexts when they first exist to prevent auto-play video/audio ads.
//
// We explicitly re-enable it whenever the user does something on the page.
document.addEventListener('keydown', () => ctx.resume(), { once: true });
document.addEventListener('mousedown', () => ctx.resume(), { once: true });
document.addEventListener('touchstart', () => ctx.resume(), { once: true });
document.addEventListener('touchend', () => ctx.resume(), { once: true });

const createViewContextManagerUI = (engine: typeof import('./engine')) => {
  ReactDOM.createRoot(document.getElementById('view-context-manager')!).render(
    <Provider store={store}>
      <ViewContextManager engine={engine} />
    </Provider>
  );

  ReactDOM.createRoot(document.getElementById('view-context-switcher')!).render(
    <Provider store={store}>
      <ViewContextSwitcher engine={engine} />
    </Provider>
  );
};

const createBrowserNotSupportedMessage = () => {
  const body = document.getElementsByTagName('body')[0];
  while (body.children.length > 0) {
    body.children[0].remove();
  }

  ReactDOM.createRoot(body).render(<BrowserNotSupported />);
};

export const init_view_contexts = (
  activeViewContextIx: number,
  activeVcsJson: string,
  connectionsJson: string,
  foreignConnectablesJson: string
): void => {
  const activeViewContexts = tryParseJson<
    {
      minimal_def: { name: string; uuid: string; title?: string };
    }[]
  >(activeVcsJson, [], 'Failed to parse JSON of `activeViewContexts`; clearing all view contexts');

  const connections = tryParseJson<[ConnectableDescriptor, ConnectableDescriptor][]>(
    connectionsJson,
    [],
    'Failed to parse provided connections out of JSON'
  );

  const foreignConnectables = tryParseJson<{ type: string; id: string; serializedState: string }[]>(
    foreignConnectablesJson,
    [],
    'Failed to parse foreign nodes JSON; using an empty list but that will probably create invalid connections.'
  );

  dispatch(actionCreators.viewContextManager.SET_IS_LOADED(false));

  const newVCMState: Pick<VCMState, 'activeViewContextIx' | 'activeViewContexts'> & {
    foreignConnectables: { type: string; id: string; params?: { [key: string]: any } | null }[];
  } = {
    activeViewContextIx,
    activeViewContexts: activeViewContexts.map(({ minimal_def, ...rest }) => ({
      ...minimal_def,
      ...rest,
    })),
    foreignConnectables,
  };

  // Trigger a side effect of updating the patch network with the new state
  const patchNetwork = initPatchNetwork(
    getState().viewContextManager.patchNetwork,
    newVCMState.activeViewContexts,
    newVCMState.foreignConnectables,
    connections,
    ctx
  );
  dispatch(actionCreators.viewContextManager.SET_VCM_STATE(newVCMState, patchNetwork));
};

export const add_view_context = (id: string, name: string) => {
  const engine = getEngine()!; // Must exist because this gets called *from the engine*.
  dispatch(actionCreators.viewContextManager.ADD_VIEW_CONTEXT(id, name));
  dispatch(
    actionCreators.viewContextManager.ADD_PATCH_NETWORK_NODE(id, engine.get_vc_connectables(id))
  );
};

export const delete_view_context = (id: string) => {
  dispatch(actionCreators.viewContextManager.REMOVE_PATCH_NETWORK_NODE(id));
  dispatch(actionCreators.viewContextManager.DELETE_VIEW_CONTEXT(id));
};

export const set_active_vc_ix = (newActiveVxIx: number) => {
  const oldActiveVcIx = getState().viewContextManager.activeViewContextIx;
  const oldActiveVcId = getState().viewContextManager.activeViewContexts[oldActiveVcIx]?.uuid;
  if (oldActiveVcId) {
    onVcHideStatusChange(oldActiveVcId, true);
  }

  const newActiveVcId = getState().viewContextManager.activeViewContexts[newActiveVxIx].uuid;
  onVcHideStatusChange(newActiveVcId, false);

  dispatch(actionCreators.viewContextManager.SET_ACTIVE_VC_IX(newActiveVxIx));
};

/**
 * Fetches the shared composition with the provided ID, deserializes it, and populates localstorage with its contents.
 * This function does NOT handle re-initializing the application, destroying + recreacting VCs, etc. and is designed
 * to be used before the application is first loaded.
 */
export const fetchAndLoadSharedComposition = async (
  compositionID: string | number,
  force?: boolean
) => {
  console.log(`Loading composition id=${compositionID}`);

  const composition = await getLoadedComposition(compositionID);
  if (!composition) {
    return;
  }
  await loadSharedComposition(composition, force);
};

if (typeof AudioWorkletNode === 'undefined') {
  createBrowserNotSupportedMessage();
} else {
  initSentry();

  wasm.then(async engine => {
    setEngine(engine);

    // Check to see if the user has reached this page via a composition share link.  If so,
    // save the current composition and load the shared one before initializing.
    if (window.location.pathname.startsWith('/composition/')) {
      await fetchAndLoadSharedComposition(window.location.pathname.split('/composition/')[1]);
    } else {
      await maybeRestoreLocalComposition();
    }

    registerMainReduxGetState(getState);

    engine.init();

    window.addEventListener('beforeunload', () => onBeforeUnload(engine));

    createViewContextManagerUI(engine);
  });
}
