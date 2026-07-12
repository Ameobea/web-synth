import * as R from 'ramda';
import download from 'downloadjs';
import { Either } from 'funfix-core';

import { getLoadedComposition } from 'src/api';
import type { CompositionDefinition } from 'src/compositionSharing/CompositionSharing';
import { stopAll } from 'src/eventScheduler/eventScheduler';
import { loadTempoFromComposition } from 'src/globalMenu/globalTempo';
import { actionCreators, dispatch, getState } from 'src/redux';
import { commitForeignConnectables } from 'src/redux/modules/vcmUtils';
import { AsyncOnce, getEngine } from 'src/util';

export const serializeAndDownloadComposition = () => {
  download(JSON.stringify(localStorage), 'composition.json', 'application/json');
};

/**
 * Resets the current state of the application, tearing down + cleaning up all modules and VCs and re-initializes
 * with the provided composition.
 */
export const reinitializeWithComposition = (
  compositionBody:
    | { type: 'serialized'; value: string; id?: number | null }
    | { type: 'parsed'; value: { [key: string]: string }; id?: number | null },
  engine: typeof import('./engine'),
  allViewContextIds: string[]
): Either<string, void> => {
  let deserialized: { [key: string]: string };
  if (compositionBody.type === 'serialized') {
    try {
      deserialized = JSON.parse(compositionBody.value);
    } catch (_err) {
      return Either.left('Failed to parse provided JSON');
    }
  } else {
    deserialized = compositionBody.value;
  }

  // Sanity-check the VCM state before tearing anything down; the engine panics mid-`init()` on
  // malformed `vcmState`, which would otherwise destroy the current composition unrecoverably
  try {
    const vcmState = JSON.parse(deserialized.vcmState);
    const requiredFields = [
      'view_context_ids',
      'active_view_ix',
      'patch_network_connections',
      'foreign_connectables',
    ];
    const missingField = requiredFields.find(field => !(field in vcmState));
    if (missingField) {
      return Either.left(`Invalid composition; \`vcmState\` is missing field "${missingField}"`);
    }
  } catch (_err) {
    return Either.left('Invalid composition; missing or unparseable `vcmState`');
  }

  // Stop any playback
  stopAll();

  // Tear down current application state, continuing past any VC whose teardown throws so a single
  // failure can't leave the app half-torn-down mid composition switch
  allViewContextIds.forEach(id => {
    try {
      engine.delete_vc_by_id(id);
    } catch (err) {
      console.error(`Error deleting vcId=${id} during composition switch:`, err);
    }
  });
  getState().viewContextManager.patchNetwork.connectables.forEach(connectable => {
    dispatch(actionCreators.viewContextManager.REMOVE_PATCH_NETWORK_NODE(connectable.vcId));
  });

  // Rehydrate `localStorage` with parsed composition
  Object.entries(deserialized).forEach(([key, val]) => localStorage.setItem(key, val));

  // Apply tempo from the composition body (authoritative — see `loadTempoFromComposition`); pushes
  // it to the clock owner and the readable BPM output.
  loadTempoFromComposition(deserialized);

  if (!R.isNil(compositionBody.id)) {
    setCurLoadedCompositionId(compositionBody.id);
  }

  // Trigger applicaion to refresh using the newly set `localStorage` content
  engine.init();

  return Either.right(void 0);
};

// Dexie is lazy-loaded to keep it out of entrypoint bundles
const LocalCompDB = new AsyncOnce(async () => {
  const { default: Dexie } = await import('dexie');
  const client = new Dexie('savedLocalComposition');
  client.version(1).stores({
    localComposition: '',
    currentLoadedCompositionId: '',
  });
  return {
    localComposition: client.table('localComposition'),
    currentLoadedCompositionId: client.table('currentLoadedCompositionId'),
  };
});

export const persistAllVCsAndFCs = () => {
  const engine = getEngine()!;
  const allVCs = getState().viewContextManager.activeViewContexts;
  for (const vc of allVCs) {
    engine.persist_vc_state(vc.uuid);
  }
  commitForeignConnectables(
    engine,
    getState().viewContextManager.patchNetwork.connectables.filter(({ node }) => !!node)
  );
};

export const onBeforeUnload = (engine: typeof import('src/engine')) => {
  // Commit the whole patch network's foreign connectables, serializing + saving their state in the process
  commitForeignConnectables(
    engine,
    getState().viewContextManager.patchNetwork.connectables.filter(({ node }) => !!node)
  );

  // Persist each VC's state, continuing past any that throw.  A JS exception thrown through a Wasm
  // import unwinds straight out of the engine, so persisting inside a Rust loop (as
  // `handle_window_close` does) lets one bad serializer abandon all later VCs and the final
  // `save_all`; driving the loop here keeps the failure isolated.
  for (const vc of getState().viewContextManager.activeViewContexts) {
    try {
      engine.persist_vc_state(vc.uuid);
    } catch (err) {
      console.error(`Error persisting state for vcId=${vc.uuid} on unload:`, err);
    }
  }
  engine.save_all();
};

/**
 * Populates localstorage with the contents of the provided composition.  This function does NOT handle
 * re-initializing the application, destroying + recreacting VCs, etc. and is designed to be used before the
 * application is first loaded.
 */
export const loadSharedComposition = async (
  composition: CompositionDefinition,
  force?: boolean,
  retainLocalStorage?: boolean
) => {
  // Headless never restores local compositions, so skip the Dexie bookkeeping and keep it off
  // the critical loading path
  if (!(window as any).isHeadless) {
    const db = await LocalCompDB.get();

    // If we already have a local composition saved in the DB, we don't want to overwrite it.
    const hasSavedLocalComposition = (await db.localComposition.count()) > 0;
    if (!hasSavedLocalComposition) {
      const serialized = JSON.stringify(localStorage);
      await db.localComposition.add(serialized, ['']);
    }

    // If the shared composition is already loaded, we will use whatever forked version the user
    // has locally rather than refresh again.
    const [prevLoadedCompId] = await db.currentLoadedCompositionId.toArray();
    if (prevLoadedCompId === composition.id && !force) {
      console.log('Loaded comp id matches existing; not refreshing from scratch');
      return;
    }
  }

  // Parse before committing the loaded composition id so a parse failure can't leave the DB
  // claiming this composition is loaded
  const deserialized = JSON.parse(composition.content);
  const keysToRetain = ['globalVolume'];
  const retainedValues = keysToRetain.map(key => [key, localStorage.getItem(key)]);
  if (!retainLocalStorage) {
    localStorage.clear();
  }
  Object.entries(deserialized)
    .filter(([key]) => !keysToRetain.includes(key))
    .forEach(([key, val]) => localStorage.setItem(key, val as any));
  retainedValues.forEach(([key, val]) => {
    if (key && val !== null && val !== undefined) {
      localStorage.setItem(key, val as any);
    }
  });

  // Apply tempo from the composition body (authoritative — see `loadTempoFromComposition`); pushes
  // it to the clock owner and the readable BPM output.
  loadTempoFromComposition(deserialized);

  if (!(window as any).isHeadless) {
    const db = await LocalCompDB.get();
    await db.currentLoadedCompositionId.clear();
    await db.currentLoadedCompositionId.add(composition.id, ['']);
  }
};

export const getCurLoadedCompositionId = async (): Promise<number | null> => {
  const db = await LocalCompDB.get();
  const [id] = await db.currentLoadedCompositionId.toArray();
  return id ? +id : null;
};

export const setCurLoadedCompositionId = async (id: number | null) => {
  const db = await LocalCompDB.get();
  await db.currentLoadedCompositionId.clear();
  if (id !== null) {
    await db.currentLoadedCompositionId.add(id, ['']);
  }
};

export const clearLocalComposition = async () => (await LocalCompDB.get()).localComposition.clear();

export const maybeRestoreLocalComposition = async () => {
  const db = await LocalCompDB.get();
  const hasSavedLocalComposition = (await db.localComposition.count()) > 0;
  if (!hasSavedLocalComposition) {
    return;
  }

  const [serializedSavedComp] = (await db.localComposition.toArray()) as string[];
  const savedComp: Record<string, string> = JSON.parse(serializedSavedComp);
  localStorage.clear();
  Object.entries(savedComp).forEach(([key, val]) => localStorage.setItem(key, val as any));

  await db.currentLoadedCompositionId.clear();
  await clearLocalComposition();
};

/**
 * Fetches the shared composition with the provided ID, deserializes it, and populates localstorage with its contents.
 * This function does NOT handle re-initializing the application, destroying + recreacting VCs, etc. and is designed
 * to be used before the application is first loaded.
 */
export const fetchAndLoadSharedComposition = async (
  compositionID: string | number,
  force?: boolean,
  retainLocalStorage?: boolean
) => {
  console.log(`Loading composition id=${compositionID}`);

  const composition = await getLoadedComposition(compositionID);
  if (!composition) {
    console.error(`Failed to load composition id=${compositionID}; not found?`);
    return;
  }
  await loadSharedComposition(composition, force, retainLocalStorage);
};

const LoginTokenTable = new AsyncOnce(async () => {
  const { default: Dexie } = await import('dexie');
  const client = new Dexie('loginToken');
  client.version(1).stores({
    loginToken: '',
  });
  return client.table('loginToken');
});

let cachedLoginToken: string | null = null;
// only one token fetched at a time
let fetchingLoginToken: Promise<string> | null = null;

export const getLoginToken = async (): Promise<string> => {
  if (cachedLoginToken) {
    return cachedLoginToken;
  } else if (fetchingLoginToken) {
    return fetchingLoginToken;
  }

  fetchingLoginToken = (async () => {
    try {
      const table = await LoginTokenTable.get();
      const [token] = await table.toArray();
      cachedLoginToken = token || '';
      return token || '';
    } finally {
      fetchingLoginToken = null;
    }
  })();

  return fetchingLoginToken;
};

export const setLoginToken = async (token: string) => {
  const table = await LoginTokenTable.get();
  await table.clear();
  await table.add(token, ['']);
  cachedLoginToken = token;
};
