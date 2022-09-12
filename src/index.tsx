import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

const wasm = import('./engine');
import { store, getState } from './redux';
import { setEngine } from 'src/util';
import { ViewContextManager, ViewContextSwitcher } from './ViewContextManager';
import {
  fetchAndLoadSharedComposition,
  maybeRestoreLocalComposition,
  onBeforeUnload,
} from 'src/persistance';
import { initSentry } from 'src/sentry';
import { registerMainReduxGetState } from 'src/ViewContextManager/VcHideStatusRegistry';
import { createBrowserNotSupportedMessage } from 'src/misc/BrowserNotSupported';

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
