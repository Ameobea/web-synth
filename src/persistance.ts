import download from 'downloadjs';
import { Either } from 'funfix-core';

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
