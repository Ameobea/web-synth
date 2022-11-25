/**
 * Implements a cache for samples that are stored directly in the browser via IndexedDB.  This removes the need for
 * samples to be re-fetched via the internet or loaded from local disk which requires permissions and user action.
 */
import Dexie from 'dexie';
import * as R from 'ramda';

import type { SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';

const MAX_CACHE_SIZE_BYTES = 1024 * 1024 * 500; // 500MB

const dbClient = new Dexie('sampleCache');

dbClient.version(1).stores({
  samples: '[isLocal+name+id], lastAccessed, sizeBytes, url',
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

const samplesTable = (dbClient as any).samples as Dexie.Table<SampleRow, any>;

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
  let totalBytesUsed = 0;
  await samplesTable.each(row => {
    totalBytesUsed += row.sizeBytes;
  });
  return totalBytesUsed;
};

const maybePruneOldEntries = async (neededBytes: number) => {
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

export const getIsSampleCached = async (descriptor: SampleDescriptor): Promise<boolean> => {
  const whereClause = buildWhereClause(descriptor);
  const row = await samplesTable.where(whereClause).first();
  return !!row;
};

export const getAllCachedSamples = async (): Promise<SampleDescriptor[]> => {
  const allSamples = await samplesTable.toArray();
  return allSamples.map(buildDescriptor);
};
