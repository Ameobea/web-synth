import * as R from 'ramda';
import { UnimplementedError } from 'ameo-utils';

import { getFSAccess } from 'src/fsAccess';
import SampleManager from 'src/sampleLibrary/SampleManager';
import { mkContainerRenderHelper, mkContainerCleanupHelper } from 'src/reactUtils';
import SampleLibraryUI from 'src/sampleLibrary/SampleLibraryUI/SampleLibraryUI';
import { cacheSample, getCachedSample, getAllCachedSamples } from 'src/sampleLibrary/sampleCache';

export interface SampleDescriptor {
  isLocal: boolean;
  name: string;
}

export const hashSampleDescriptor = ({ isLocal, name }: SampleDescriptor): string =>
  `${isLocal}-${name}`;

const GLOBAL_SAMPLE_MANAGER = new SampleManager();

const ctx = new AudioContext();

const listLocalSamples = async (): Promise<SampleDescriptor[]> => {
  const fsAccess = await getFSAccess();
  const samplesDirHandle = await fsAccess.getDirectory('samples');
  const dirEntries = await samplesDirHandle.getEntries();

  const descriptors: SampleDescriptor[] = [];
  for await (const entry of dirEntries) {
    if (entry.isDirectory) {
      continue;
    }

    descriptors.push({ isLocal: true, name: entry.name });
  }

  return descriptors;
};

const loadLocalSample = async (descriptor: SampleDescriptor): Promise<ArrayBuffer> => {
  const fsAccess = await getFSAccess();
  const sampleFile = await fsAccess.getFile('samples', descriptor.name);
  // TS doesn't like the `.arrayBuffer()` method on `File`/`Blob` for whatever reason
  return (sampleFile as any).arrayBuffer() as Promise<ArrayBuffer>;
};

const loadRemoteSample = async (descriptor: SampleDescriptor): Promise<ArrayBuffer> => {
  throw new UnimplementedError(); // TODO
};

const listRemoteSamples = async (): Promise<SampleDescriptor[]> => {
  return []; // TODO
};

export interface ListSampleOpts {
  includeLocal?: boolean;
  includeRemote?: boolean;
}

export const listSamples = async ({
  includeRemote,
  includeLocal,
}: ListSampleOpts = {}): Promise<SampleDescriptor[]> => {
  const [cachedSamples, localSamples, remoteSamples] = await Promise.all([
    getAllCachedSamples(),
    includeLocal ? listLocalSamples().catch(() => []) : [],
    includeRemote ? listRemoteSamples() : [],
  ]);

  // De-dup samples, only retaining unique descriptors
  const allSamples: Map<string, SampleDescriptor> = new Map();
  [...cachedSamples, ...localSamples, ...remoteSamples].forEach(descriptor =>
    allSamples.set(hashSampleDescriptor(descriptor), descriptor)
  );

  return [...allSamples.values()];
};

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

  // We don't have the sample available, so we load it from its original source
  const sampleData = await (descriptor.isLocal
    ? loadLocalSample(descriptor)
    : loadRemoteSample(descriptor));
  const buf = await ctx.decodeAudioData(sampleData.slice(0));

  // Add it to both levels of cache
  cacheSample(descriptor, sampleData);
  GLOBAL_SAMPLE_MANAGER.setSample(descriptor, buf);

  return buf;
};

export const init_sample_library = (stateKey: string) => {
  const elem = document.createElement('div');
  elem.id = stateKey;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  mkContainerRenderHelper({
    Comp: SampleLibraryUI,
    getProps: () => ({}),
  })(stateKey);
};

export const cleanup_sample_library = mkContainerCleanupHelper();

export const hide_sample_library = (stateKey: string) => {
  const elem = document.getElementById(stateKey);
  if (!elem) {
    const vcId = stateKey.split('_')[1]!;
    console.error(`Unable to find DOM element for sample library with vcId ${vcId}; can't hide.`);
    return;
  }

  elem.style.display = 'none';
};

export const unhide_sample_library = (stateKey: string) => {
  const elem = document.getElementById(stateKey);
  if (!elem) {
    const vcId = stateKey.split('_')[1]!;
    console.error(`Unable to find DOM element for sample library with vcId ${vcId}; can't unhide.`);
    return;
  }

  elem.style.display = 'block';
};
