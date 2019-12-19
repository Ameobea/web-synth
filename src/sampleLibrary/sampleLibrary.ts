import { UnimplementedError } from 'ameo-utils';

import { getFSAccess } from 'src/fsAccess';
import SampleManager from 'src/sampleLibrary/SampleManager';
import { mkContainerRenderHelper, mkContainerCleanupHelper } from 'src/reactUtils';
import SampleLibraryUI from 'src/sampleLibrary/SampleLibraryUI/SampleLibraryUI';

export interface SampleDescriptor {
  isLocal: boolean;
  name: string;
}

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

const loadLocalSample = async (descriptor: SampleDescriptor): Promise<AudioBuffer> => {
  const fsAccess = await getFSAccess();
  const sampleFile = await fsAccess.getFile('samples', descriptor.name);
  // TS doesn't like the `.arrayBuffer()` method on `File`/`Blob` for whatever reason
  const sampleData = await ((sampleFile as any).arrayBuffer() as Promise<ArrayBuffer>);

  return ctx.decodeAudioData(sampleData);
};

const loadRemoteSample = async (descriptor: SampleDescriptor): Promise<AudioBuffer> => {
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
  const [localSamples, remoteSamples] = await Promise.all([
    includeLocal ? listLocalSamples().catch(() => []) : [],
    includeRemote ? listRemoteSamples() : [],
  ]);

  return [...localSamples, ...remoteSamples];
};

export const getSample = async (descriptor: SampleDescriptor): Promise<AudioBuffer> => {
  const cachedSample = GLOBAL_SAMPLE_MANAGER.getSample(descriptor);
  if (cachedSample) {
    return cachedSample;
  }

  return descriptor.isLocal ? loadLocalSample(descriptor) : loadRemoteSample(descriptor);
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
