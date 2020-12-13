import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

const wasm = import('./engine');
import { actionCreators, dispatch, store, getState } from './redux';
import { ViewContextManager, ViewContextSwitcher } from './ViewContextManager';
import { commitForeignConnectables, VCMState } from 'src/redux/modules/viewContextManager';
import { tryParseJson } from 'src/util';
import { ConnectableDescriptor, initPatchNetwork } from 'src/patchNetwork';
import BrowserNotSupported from 'src/misc/BrowserNotSupported';
import { CompositionDefinition } from 'src/compositionSharing/CompositionSharing';
import { BACKEND_BASE_URL } from 'src/conf';
import { loadSharedComposition, maybeRestoreLocalComposition } from 'src/persistance';

const ctx = new AudioContext();
let engineHandle: typeof import('./engine');

export const getEngine = (): typeof import('./engine') | undefined => engineHandle;

const createViewContextManagerUI = (engine: typeof import('./engine')) => {
  ReactDOM.unstable_createRoot(document.getElementById('view-context-manager')).render(
    <Provider store={store}>
      <ViewContextManager engine={engine} />
    </Provider>
  );

  ReactDOM.unstable_createRoot(document.getElementById('view-context-switcher')).render(
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

  ReactDOM.unstable_createRoot(body).render(<BrowserNotSupported />);
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

export const set_active_vc_ix = (newActiveVxIx: number) =>
  dispatch(actionCreators.viewContextManager.SET_ACTIVE_VC_IX(newActiveVxIx));

const fetchAndLoadSharedComposition = async (compositionId: string) => {
  console.log(`Loading composition id=${compositionId}`);
  const res = await fetch(`${BACKEND_BASE_URL}/compositions/${compositionId}`);
  if (res.status === 404) {
    alert(`Composition with id "${compositionId}" not found`);
    return;
  } else if (!res.ok) {
    alert(`Error loading composition: ${await res.text()}`);
    return;
  }

  const composition: CompositionDefinition = await res.json();
  await loadSharedComposition(composition);
};

if (typeof AudioWorkletNode === 'undefined') {
  createBrowserNotSupportedMessage();
} else {
  wasm.then(async engine => {
    engineHandle = engine;

    // Check to see if the user has reached this page via a composition share link.  If so,
    // save the current composition and load the shared one before initializing.
    if (window.location.pathname.startsWith('/composition/')) {
      await fetchAndLoadSharedComposition(window.location.pathname.split('/composition/')[1]);
    } else {
      await maybeRestoreLocalComposition();
    }

    engine.init();

    window.addEventListener('beforeunload', () => {
      // Commit the whole patch network's foreign connectables, serializing + saving their state in the process
      commitForeignConnectables(
        engine,
        getState().viewContextManager.patchNetwork.connectables.filter(({ node }) => !!node)
      );

      // Cleanup all VCs and save their state
      engine.handle_window_close();
    });

    createViewContextManagerUI(engine);
  });
}
