import * as R from 'ramda';

import { listRemoteSamples as listRemoteSamplesFromServer } from 'src/api';
import { getFSAccess } from 'src/fsAccess';
import type { FileSystemDirectoryHandle } from 'src/fsAccess/drivers/nativeFS/NativeFSTypes';
import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';
import { cacheSample, getAllCachedSamples, getCachedSample } from 'src/sampleLibrary/sampleCache';
import SampleLibraryUI from 'src/sampleLibrary/SampleLibraryUI/SampleLibraryUI';
import SampleManager from 'src/sampleLibrary/SampleManager';
import { UnimplementedError } from 'src/util';

export interface SampleDescriptor {
  isLocal: boolean;
  name: string;
  id?: string;
  url?: string;
}

export const hashSampleDescriptor = ({ isLocal, name }: SampleDescriptor): string =>
  `${isLocal}-${name}`;

const GLOBAL_SAMPLE_MANAGER = new SampleManager();
(window as any).SampleManager = GLOBAL_SAMPLE_MANAGER;

const ctx = new AudioContext();

const traverseDir = async (
  dirHandle: FileSystemDirectoryHandle,
  prefix = ''
): Promise<SampleDescriptor[]> => {
  const entries = await dirHandle.entries();
  const descriptors: SampleDescriptor[] = [];

  const childDirs: Promise<SampleDescriptor[]>[] = [];

  for await (const [, entry] of entries) {
    if (entry.kind === 'directory') {
      childDirs.push(traverseDir(entry, prefix + entry.name + '/'));
      continue;
    }

    descriptors.push({ isLocal: true, name: `${prefix}${entry.name}` });
  }

  const childDescriptors = await Promise.all(childDirs);
  const flattenedChildDescriptors: SampleDescriptor[] = R.unnest(childDescriptors);

  return [...descriptors, ...flattenedChildDescriptors];
};

const listLocalSamples = async (): Promise<SampleDescriptor[]> => {
  const fsAccess = await getFSAccess();
  const samplesDirHandle = await fsAccess.getDirectory('samples');
  return traverseDir(samplesDirHandle);
};

const loadLocalSample = async (descriptor: SampleDescriptor): Promise<ArrayBuffer> => {
  const fsAccess = await getFSAccess();
  const sampleFile = await fsAccess.getFile('samples', descriptor.name);
  return sampleFile.arrayBuffer() as Promise<ArrayBuffer>;
};

const saveLocalSample = async (descriptor: SampleDescriptor, sampleData: ArrayBuffer) => {
  const fsAccess = await getFSAccess();
  const samplesDirHandle = await fsAccess.getDirectory('samples');
  // Create recorded samples dir if doesn't exist
  let recordedSamplesDir: FileSystemDirectoryHandle | undefined;
  for await (const [name, entry] of samplesDirHandle.entries()) {
    if (name === 'recorded' && entry.kind === 'directory') {
      recordedSamplesDir = entry;
      break;
    }
  }
  if (!recordedSamplesDir) {
    recordedSamplesDir = await samplesDirHandle.getDirectoryHandle('recorded', { create: true });
  }

  const fileHandle = await recordedSamplesDir.getFileHandle(descriptor.name, { create: true });
  const fileWriter = await fileHandle.createWritable();
  const rs = new Blob([sampleData]).stream();
  await rs.pipeTo(fileWriter);
  console.log({ rs });
};

const loadRemoteSample = async (descriptor: SampleDescriptor): Promise<ArrayBuffer> => {
  if (!descriptor.url) {
    throw new UnimplementedError('Unable to load remote sample without URL');
  }

  return fetch(descriptor.url!).then(res => res.arrayBuffer());
};

const listRemoteSamples = async (): Promise<SampleDescriptor[]> => {
  const remoteSamples = await listRemoteSamplesFromServer();
  return remoteSamples.map(({ sampleUrl, ...descriptor }) => ({
    ...descriptor,
    isLocal: false,
    url: sampleUrl,
  }));
};

export interface ListSampleOpts {
  includeCached?: boolean;
  includeLocal?: boolean;
  includeRemote?: boolean;
}

export const listSamples = async ({
  includeCached,
  includeRemote,
  includeLocal,
}: ListSampleOpts = {}): Promise<SampleDescriptor[]> => {
  const [cachedSamples, localSamples, remoteSamples] = await Promise.all([
    includeCached ? getAllCachedSamples() : [],
    includeLocal
      ? listLocalSamples().catch(err => {
          console.warn(err);
          return [];
        })
      : [],
    includeRemote ? listRemoteSamples() : [],
  ]);

  // De-dup samples, only retaining unique descriptors
  const allSamples: Map<string, SampleDescriptor> = new Map();
  [...cachedSamples, ...localSamples, ...remoteSamples].forEach(descriptor =>
    allSamples.set(hashSampleDescriptor(descriptor), descriptor)
  );

  return [...allSamples.values()];
};

const ActiveFetchesByHash = new Map<string, Promise<AudioBuffer>>();

/**
 * This is the main entrypoint for loading sample from descriptors.  It will check both layers of cache first and
 * if the sample is not available, it will attempt to load it from its source (local filesystem or remote URL).
 */
export const getSample = async (descriptor: SampleDescriptor): Promise<AudioBuffer> => {
  // First we check the highest level of cache, the in-memory sample manager
  const cachedSample = GLOBAL_SAMPLE_MANAGER.getSample(descriptor);
  if (cachedSample) {
    return cachedSample;
  }

  // Then we check the second level of cache, the on-disk IndexedDB cache to see if we have the desired sample available
  const diskCachedSample = await getCachedSample(descriptor);
  if (!R.isNil(diskCachedSample)) {
    const buf = await ctx.decodeAudioData(diskCachedSample);
    // Add it to the top level cache
    GLOBAL_SAMPLE_MANAGER.setSample(descriptor, buf);
    return buf;
  }

  const activeFetch = ActiveFetchesByHash.get(hashSampleDescriptor(descriptor));
  if (activeFetch) {
    return activeFetch;
  }

  const prom = new Promise<AudioBuffer>(async resolve => {
    // We don't have the sample available, so we load it from its original source
    const sampleData = await (descriptor.isLocal
      ? loadLocalSample(descriptor)
      : loadRemoteSample(descriptor));
    const buf = await ctx.decodeAudioData(sampleData.slice(0));

    // Add it to both levels of cache
    cacheSample(descriptor, sampleData);
    GLOBAL_SAMPLE_MANAGER.setSample(descriptor, buf);

    resolve(buf);
  });

  ActiveFetchesByHash.set(hashSampleDescriptor(descriptor), prom);
  return prom;
};

/**
 * Adds a sample to the sample manager and saves it locally as well
 */
export const addLocalSample = async (descriptor: SampleDescriptor, sampleData: ArrayBuffer) => {
  await saveLocalSample(descriptor, sampleData);
  const decoded = await ctx.decodeAudioData(sampleData);
  GLOBAL_SAMPLE_MANAGER.setSample(descriptor, decoded);
};

export const init_sample_library = (stateKey: string) => {
  const elem = document.createElement('div');
  elem.id = stateKey;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  mkContainerRenderHelper({
    Comp: SampleLibraryUI,
    getProps: () => ({}),
    enableReactQuery: true,
  })(stateKey);
};

export const cleanup_sample_library = mkContainerCleanupHelper();

export const hide_sample_library = mkContainerHider((vcId: string) => `SampleLibrary_${vcId}`);

export const unhide_sample_library = mkContainerUnhider((vcId: string) => `SampleLibrary_${vcId}`);
