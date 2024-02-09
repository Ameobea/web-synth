import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider as ReactQueryProvider } from 'react-query';
import { Provider } from 'react-redux';

import { createBrowserNotSupportedMessage } from 'src/misc/BrowserNotSupported';
import {
  fetchAndLoadSharedComposition,
  maybeRestoreLocalComposition,
  onBeforeUnload,
} from 'src/persistance';
import { getReactQueryClient } from 'src/reactUtils';
import { initializeDefaultVCMState } from 'src/redux/modules/vcmUtils';
import { getSentry, initSentry } from 'src/sentry';
import { getEngine, initGlobals, setEngine } from 'src/util';
import { registerMainReduxGetState } from 'src/ViewContextManager/VcHideStatusRegistry';
import { getState, store } from './redux';
import { ViewContextManager, ViewContextSwitcher } from './ViewContextManager';

initGlobals();

const wasm = import('./engine');

const ctx = new AudioContext();

// Web browsers like to disable audio contexts when they first exist to prevent auto-play video/audio ads.
//
// We explicitly re-enable it whenever the user does something on the page.
document.addEventListener('keydown', () => ctx.resume(), { once: true });
document.addEventListener('mousedown', () => ctx.resume(), { once: true });
document.addEventListener('touchstart', () => ctx.resume(), { once: true });
document.addEventListener('touchend', () => ctx.resume(), { once: true });

const createViewContextManagerUI = (engine: typeof import('./engine')) => {
  createRoot(document.getElementById('view-context-manager')!).render(
    <ReactQueryProvider client={getReactQueryClient()}>
      <Provider store={store}>
        <ViewContextManager engine={engine} />
      </Provider>
    </ReactQueryProvider>
  );

  createRoot(document.getElementById('view-context-switcher')!).render(
    <Provider store={store}>
      <ViewContextSwitcher engine={engine} />
    </Provider>
  );
};

export const handleGlobalMouseDown = (evt: MouseEvent) => {
  if (evt.button === 3) {
    evt.preventDefault();
    getEngine()?.undo_view_change();
  } else if (evt.button === 4) {
    evt.preventDefault();
    getEngine()?.redo_view_change();
  }
};

// Match my VS code experience with mouse buttons for "go back" and "go forward"
const registerBackForwardsMouseHandlers = () => {
  document.addEventListener('mouseup', evt => {
    handleGlobalMouseDown(evt);
  });
};

if (typeof AudioWorkletNode === 'undefined') {
  createBrowserNotSupportedMessage();
} else {
  initSentry();

  wasm.then(async engine => {
    setEngine(engine);

    registerBackForwardsMouseHandlers();

    registerMainReduxGetState(getState);

    const isLoadingComposition = window.location.pathname.startsWith('/composition/');
    if (!localStorage.vcmState && !isLoadingComposition) {
      initializeDefaultVCMState();
    } else {
      // Check to see if the user has reached this page via a composition share link.  If so,
      // save the current composition and load the shared one before initializing.
      if (isLoadingComposition) {
        await fetchAndLoadSharedComposition(window.location.pathname.split('/composition/')[1]);
      } else {
        await maybeRestoreLocalComposition();
      }

      try {
        engine.init();
      } catch (e) {
        getSentry()?.captureException(e);
      }
    }

    window.addEventListener('beforeunload', () => onBeforeUnload(engine));

    createViewContextManagerUI(engine);
  });
}
