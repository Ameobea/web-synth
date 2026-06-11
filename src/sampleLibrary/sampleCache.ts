/**
 * Implements a cache for samples that are stored directly in the browser via IndexedDB.  This removes the need for
 * samples to be re-fetched via the internet or loaded from local disk which requires permissions and user action.
 */
import type { Table } from 'dexie';
import * as R from 'ramda';

import type { SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';
import { AsyncOnce } from 'src/util';

const MAX_CACHE_SIZE_BYTES = 1024 * 1024 * 500; // 500MB

// Dexie is lazy-loaded to keep it out of entrypoint bundles
const SamplesTable = new AsyncOnce(async () => {
  const { default: Dexie } = await import('dexie');
  const dbClient = new Dexie('sampleCache');
  dbClient.version(1).stores({
    samples: '[isLocal+name+id], lastAccessed, sizeBytes, url',
  });
  return (dbClient as any).samples as Table<SampleRow, any>;
});

interface SampleRow {
  name: string;
  id: string;
  url?: string;
  isLocal: string;
  sizeBytes: number;
  lastAccessed: Date;
  sampleData: ArrayBuffer;
}

const buildWhereClause = (descriptor: SampleDescriptor) => ({
  name: descriptor.name,
  id: descriptor.id || '',
  isLocal: descriptor.isLocal.toString(),
});

const buildDescriptor = (row: any): SampleDescriptor => ({
  isLocal: row.isLocal === 'true',
  name: row.name,
  id: row.id ? row.id : undefined,
  url: row.url,
});

const getTotalUsedCacheSpace = async () => {
  const samplesTable = await SamplesTable.get();
  let totalBytesUsed = 0;
  await samplesTable.each(row => {
    totalBytesUsed += row.sizeBytes;
  });
  return totalBytesUsed;
};

const maybePruneOldEntries = async (neededBytes: number) => {
  const samplesTable = await SamplesTable.get();
  const usedSpace = await getTotalUsedCacheSpace();
  if (MAX_CACHE_SIZE_BYTES - usedSpace >= neededBytes) {
    return;
  }

  let freedSpace = 0;
  while (MAX_CACHE_SIZE_BYTES - usedSpace - freedSpace <= neededBytes) {
    const oldestEntry = await samplesTable.orderBy('lastAccessed').reverse().first();
    if (R.isNil(oldestEntry)) {
      throw new Error(
        "Somehow there are no entries in the samples cache but we're still over the cache limit"
      );
    }

    const deletedCount = await samplesTable
      .where(buildWhereClause(buildDescriptor(oldestEntry)))
      .delete();
    if (deletedCount !== 1) {
      throw new Error(`Expected to delete a single sample but deleted ${deletedCount}`);
    }

    freedSpace += oldestEntry.sizeBytes;
  }
};

export const cacheSample = async (descriptor: SampleDescriptor, sampleData: ArrayBuffer) => {
  if (sampleData.byteLength > MAX_CACHE_SIZE_BYTES) {
    throw new Error('Tried to store sample that is larger than the max cache size');
  }

  // Check to see if out cache is out of space.  If it is, we have to evict entries until we have enough space.
  await maybePruneOldEntries(sampleData.byteLength);

  const samplesTable = await SamplesTable.get();

  await samplesTable.put({
    ...descriptor,
    id: descriptor.id ? descriptor.id : '',
    isLocal: descriptor.isLocal.toString(),
    sizeBytes: sampleData.byteLength,
    lastAccessed: new Date(),
    sampleData,
  });
};

export const getCachedSample = async (
  descriptor: SampleDescriptor
): Promise<ArrayBuffer | null> => {
  const samplesTable = await SamplesTable.get();
  const whereClause = buildWhereClause(descriptor);
  const row = await samplesTable.where(whereClause).first();
  if (R.isNil(row)) {
    return null;
  }

  const updatedCount = await samplesTable.where(whereClause).modify({ lastAccessed: new Date() });
  if (updatedCount !== 1) {
    throw new Error(
      `Expected a single row to be updated when updating last accessed time, but ${updatedCount} were updated`
    );
  }

  return row.sampleData;
};

export const getAllCachedSamples = async (): Promise<SampleDescriptor[]> => {
  const samplesTable = await SamplesTable.get();
  const allSamples = await samplesTable.toArray();
  return allSamples.map(buildDescriptor);
};
