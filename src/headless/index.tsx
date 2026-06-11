// prettier-ignore
import './headlessFlagSideEffect';

import {
  scheduleMIDIEventBeats,
  scheduleEventBeatsRelative,
  scheduleEventTimeAbsolute,
  scheduleEventTimeRelativeToStart,
  scheduleEventTimeRelativeToCurTime,
  postMIDIEventToAudioThread,
  startAll,
  stopAll,
} from 'src/eventScheduler/eventScheduler';
import { getLoadedComposition } from 'src/api';
import type { CompositionDefinition } from 'src/compositionSharing/CompositionSharing';
import { getGlobalBpm, setGlobalBpm } from 'src/globalMenu/globalTempo';
import { prefetchCompositionAssets } from 'src/headless/prefetchCompositionAssets';
import { connect, disconnect } from 'src/patchNetwork/interface';
import { loadSharedComposition } from 'src/persistance';
import { dispatch, getState } from 'src/redux';
import { setEngine } from 'src/util';
import { registerMainReduxGetState } from 'src/ViewContextManager/VcHideStatusRegistry';

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
  compositionToLoad,
}: {
  compositionIDToLoad?: number;
  /**
   * A pre-fetched composition definition.  If provided, takes precedence over
   * `compositionIDToLoad` and skips the network fetch entirely.
   */
  compositionToLoad?: CompositionDefinition;
}) => {
  if (typeof AudioWorkletNode === 'undefined') {
    const { createBrowserNotSupportedMessage } = await import('src/misc/BrowserNotSupported');
    createBrowserNotSupportedMessage();
    return;
  }

  const enginePromise = import('../engine').then(async engine => {
    await engine.default();
    return engine;
  });
  const compositionPromise = compositionToLoad
    ? Promise.resolve(compositionToLoad)
    : compositionIDToLoad
      ? getLoadedComposition(compositionIDToLoad)
      : null;
  compositionPromise
    ?.then(composition => {
      if (composition) {
        prefetchCompositionAssets(composition.content);
      }
    })
    .catch(() => {});

  const engine = await enginePromise;
  setEngine(engine);

  registerMainReduxGetState(getState);

  if (compositionPromise) {
    const composition = await compositionPromise;
    if (composition) {
      await loadSharedComposition(composition, true, true);
    } else {
      console.error(`Failed to load composition id=${compositionIDToLoad}; not found?`);
    }
  }

  engine.init();

  return {
    getState,
    dispatch,
    startAll,
    stopAll,
    disconnect,
    connect,
    getGlobalBpm,
    setGlobalBpm,
    scheduleMIDIEventBeats,
    scheduleEventBeatsRelative,
    scheduleEventTimeAbsolute,
    scheduleEventTimeRelativeToStart,
    scheduleEventTimeRelativeToCurTime,
    postMIDIEventToAudioThread,
  };
};
