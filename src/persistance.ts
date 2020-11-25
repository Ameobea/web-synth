import download from 'downloadjs';
import { Either } from 'funfix-core';
import Dexie from 'dexie';
import { CompositionDefinition } from 'src/compositionSharing/CompositionSharing';

export const serializeAndDownloadComposition = () => {
  download(JSON.stringify(localStorage), 'composition.json', 'application/json');
};

export const loadComposition = (
  compositionBody: string,
  engine: typeof import('./engine'),
  allViewContextIds: string[]
): Either<string, void> => {
  let deserialized: { [key: string]: string };
  try {
    deserialized = JSON.parse(compositionBody);
  } catch (err) {
    return Either.left('Failed to parse provided JSON');
  }

  // Tear down current application state
  allViewContextIds.forEach(engine.delete_vc_by_id);

  // Rehydrate `localStorage` with parsed composition
  Object.entries(deserialized).forEach(([key, val]) => localStorage.setItem(key, val));

  // Trigger applicaion to refresh using the newly set `localStorage` content
  engine.init();

  return Either.right(void 0);
};

const localCompDbClient = new Dexie('savedLocalComposition');
localCompDbClient.version(1).stores({
  localComposition: '',
  currentLoadedCompositionId: '',
});
const localCompositionTable = localCompDbClient.table('localComposition');
const currentLoadedCompositionIdTable = localCompDbClient.table('currentLoadedCompositionId');

export const loadSharedComposition = async (composition: CompositionDefinition) => {
  // If we already have a local composition saved in the DB, we don't want to overwrite it.
  const hasSavedLocalComposition = (await localCompositionTable.count()) > 0;
  if (!hasSavedLocalComposition) {
    const serialized = JSON.stringify(localStorage);
    await localCompositionTable.add(serialized, ['']);
  }

  // If the shared composition is already loaded, we will use whatever forked version the user
  // has locally rather than refresh again.
  const [prevLoadedCompId] = await currentLoadedCompositionIdTable.toArray();
  if (prevLoadedCompId === composition.id) {
    console.log('Loaded comp id matches existing; not refreshing from scratch');
    return;
  }

  await currentLoadedCompositionIdTable.clear();
  await currentLoadedCompositionIdTable.add(composition.id, ['']);

  const deserialized = JSON.parse(composition.content);
  localStorage.clear();
  Object.entries(deserialized).forEach(([key, val]) => localStorage.setItem(key, val as any));
};

export const maybeRestoreLocalComposition = async () => {
  const hasSavedLocalComposition = (await localCompositionTable.count()) > 0;
  if (!hasSavedLocalComposition) {
    return;
  }

  const [serializedSavedComp] = await currentLoadedCompositionIdTable.toArray();
  const savedComp = JSON.parse(serializedSavedComp);
  localStorage.clear();
  Object.entries(savedComp).forEach(([key, val]) => localStorage.setItem(key, val as any));

  await currentLoadedCompositionIdTable.clear();
  await localCompositionTable.clear();
};
