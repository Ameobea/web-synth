import { createBrowserNotSupportedMessage } from 'src/misc/BrowserNotSupported';
import { setEngine } from 'src/util';
import { getState, dispatch } from 'src/redux';
import { registerMainReduxGetState } from 'src/ViewContextManager/VcHideStatusRegistry';
import { fetchAndLoadSharedComposition } from 'src/persistance';
import { startAll, stopAll } from 'src/eventScheduler/eventScheduler';

const ctx = new AudioContext();

// Web browsers like to disable audio contexts when they first exist to prevent auto-play video/audio ads.
//
// We explicitly re-enable it whenever the user does something on the page.
document.addEventListener('keydown', () => ctx.resume(), { once: true });
document.addEventListener('mousedown', () => ctx.resume(), { once: true });
document.addEventListener('touchstart', () => ctx.resume(), { once: true });
document.addEventListener('touchend', () => ctx.resume(), { once: true });

export const initHeadlessWebSynth = async ({
  compositionIDToLoad,
}: {
  compositionIDToLoad?: number;
}) => {
  if (typeof AudioWorkletNode === 'undefined') {
    createBrowserNotSupportedMessage();
    return;
  }
  const engine = await import('../engine');
  setEngine(engine);

  registerMainReduxGetState(getState);

  if (compositionIDToLoad) {
    await fetchAndLoadSharedComposition(compositionIDToLoad, true);
  }

  engine.init();

  return { getState, dispatch, startAll, stopAll };
};
