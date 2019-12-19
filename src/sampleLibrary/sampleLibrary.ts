import { getFSAccess } from 'src/fsAccess';
import SampleManager from 'src/sampleLibrary/SampleManager';
import { UnimplementedError } from 'ameo-utils';

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

export const listSamples = async (): Promise<SampleDescriptor[]> => {
  const [localSamples, remoteSamples] = await Promise.all([
    listLocalSamples(),
    listRemoteSamples(),
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
